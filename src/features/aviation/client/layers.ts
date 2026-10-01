/**
 * Pure builders for the aviation deck layers: per-tick dead-reckoning into typed arrays, the
 * far-side/bucket visibility filter, the H3 aggregate, and the layer list itself. The React
 * component only schedules these (1 Hz, on camera moves, on new data). Client-only.
 */
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import { H3HexagonLayer } from '@deck.gl/geo-layers';
import type { LayersList, PickingInfo } from '@deck.gl/core';
import { latLngToCell } from 'h3-js';
import { getLayer, type LayerId } from '@/lib/layer-registry';
import { splitAtAntimeridian, type LngLatTuple } from '@/lib/geo';
import { readCssColor, type MapToken, type Rgba } from '@/lib/tokens';
import type { Selection } from '@/lib/layer-host';
import type { FlightRecord } from '../adsb';
import type { Bucket } from '../classify';
import { BUCKETS, MAX_DEAD_RECKON_S } from '../codec';
import type { TrackPoint } from '../trace';
import { aircraftAtlas } from './icons';
import { SdfIconLayer } from './SdfIconLayer';
import { BUCKET_LAYER } from './useFlights';
import { altitudeRamp, iconFor } from './format';

export const AGGREGATE_ABOVE = 20_000;
export const AGGREGATE_BELOW_ZOOM = 4;
const H3_RES = 3;

/**
 * GPU state for the aircraft billboards. `cullMode: 'none'` is load-bearing on the globe: MapLibre
 * leaves back-face culling enabled after drawing the globe tiles and the interleaved deck layers
 * inherit it; IconLayer flips its quad in Y (`pixelOffset.y *= -1`) so its triangles wind the
 * other way and were culled — no aircraft drew on the globe while mercator (no culling) was fine.
 * `depthCompare: 'always'` keeps the flat billboard from being half-clipped by the globe surface.
 */
export const ICON_PARAMETERS = { cullMode: 'none', depthCompare: 'always' } as const;

export interface View {
  center: LngLatTuple;
  zoom: number;
  bearing: number;
}

export interface Frame {
  records: FlightRecord[];
  /** lng, lat per record after dead-reckoning. */
  pos: Float64Array;
  frozen: Uint8Array;
  /** Indices (into records) currently drawn. */
  visible: Uint32Array;
  count: number;
  /** Visible aircraft past the dead-reckoning cap (drawn frozen and dimmed). */
  staleVisible: number;
  /** Bumped whenever the visible index list changes (per-index accessors must re-run). */
  visVersion: number;
  /** Bumped whenever an aircraft crosses the 60 s cap (colours must re-run). */
  frozenVersion: number;
  /** Stable deck `data` for the icon layer; replaced only when the visible list changes. */
  data: { length: number };
  // Per-record constants, computed once per snapshot (no per-tick objects).
  bucket: Uint8Array;
  /** Unit vector of the observed position (far-side test by dot product). */
  unit: Float64Array;
  seen: Float64Array;
  /** sinφ, cosφ, λ (rad), sinθ, cosθ, speed (km/s) for movers; speed 0 = never moves. */
  motion: Float64Array;
  /** 1 once the position and the frozen flag are final (past the cap, or never moving and frozen). */
  settled: Uint8Array;
  /** Lazily built hex → record index (trails of watched aircraft). */
  idIndex: Map<string, number> | null;
  /** Cached ring indices, keyed by visVersion + watched + selection. */
  rings: { key: string; emergencies: number[]; highlighted: number[] } | null;
}

const BUCKET_INDEX = Object.fromEntries(BUCKETS.map((b, i) => [b, i])) as Record<Bucket, number>;
/** Scratch bucket mask, reused every tick. */
const WANT = new Uint8Array(BUCKETS.length);
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const EARTH_RADIUS_KM = 6371.0088;
const KT_TO_KMS = 1.852 / 3600;
/** Aircraft beyond this angle from the camera centre are on the far side of the globe. */
const FACING_DEG = 88;
const COS_FACING = Math.cos(FACING_DEG * D2R);

export function newFrame(records: FlightRecord[]): Frame {
  const n = records.length;
  const f: Frame = {
    records,
    pos: new Float64Array(n * 2),
    frozen: new Uint8Array(n),
    visible: new Uint32Array(n),
    count: 0,
    staleVisible: 0,
    visVersion: 0,
    frozenVersion: 0,
    data: { length: 0 },
    bucket: new Uint8Array(n),
    unit: new Float64Array(n * 3),
    seen: new Float64Array(n),
    motion: new Float64Array(n * 6),
    settled: new Uint8Array(n),
    idIndex: null,
    rings: null,
  };
  for (let i = 0; i < n; i++) {
    const r = records[i]!;
    const φ = r.lat * D2R;
    const λ = r.lng * D2R;
    const cφ = Math.cos(φ);
    f.pos[i * 2] = r.lng;
    f.pos[i * 2 + 1] = r.lat;
    f.bucket[i] = BUCKET_INDEX[r.bucket];
    f.unit[i * 3] = cφ * Math.cos(λ);
    f.unit[i * 3 + 1] = cφ * Math.sin(λ);
    f.unit[i * 3 + 2] = Math.sin(φ);
    f.seen[i] = r.seenAt;
    const moves = !r.onGround && r.gsKt !== null && r.trackDeg !== null && r.gsKt > 0;
    const m = i * 6;
    f.motion[m] = Math.sin(φ);
    f.motion[m + 1] = cφ;
    f.motion[m + 2] = λ;
    f.motion[m + 3] = moves ? Math.sin(r.trackDeg! * D2R) : 0;
    f.motion[m + 4] = moves ? Math.cos(r.trackDeg! * D2R) : 0;
    f.motion[m + 5] = moves ? r.gsKt! * KT_TO_KMS : 0;
  }
  return f;
}

/** Position of record i after `dt` seconds along its great circle (same maths as geo.destination). */
function reckon(f: Frame, i: number, dt: number): void {
  const m = i * 6;
  const v = f.motion[m + 5]!;
  if (v <= 0 || dt <= 0) {
    f.pos[i * 2] = f.records[i]!.lng;
    f.pos[i * 2 + 1] = f.records[i]!.lat;
    return;
  }
  const sφ1 = f.motion[m]!;
  const cφ1 = f.motion[m + 1]!;
  const δ = (v * dt) / EARTH_RADIUS_KM;
  const sδ = Math.sin(δ);
  const cδ = Math.cos(δ);
  const sφ2 = sφ1 * cδ + cφ1 * sδ * f.motion[m + 4]!;
  const λ2 = f.motion[m + 2]! + Math.atan2(f.motion[m + 3]! * sδ * cφ1, cδ - sφ1 * sφ2);
  let lng = λ2 * R2D;
  lng = ((((lng + 180) % 360) + 360) % 360) - 180;
  f.pos[i * 2] = lng;
  f.pos[i * 2 + 1] = Math.asin(sφ2) * R2D;
}

/**
 * Dead-reckon the drawn aircraft to `now` (§0: own track and speed, at most MAX_DEAD_RECKON_S) and
 * rebuild the visible index (active buckets, camera-facing side of the globe). Allocation-free per
 * tick: aircraft outside the active buckets or on the far side are not advanced, and aircraft past
 * the 60 s cap are settled once (frozen, drawn stale) and skipped afterwards.
 */
export function advanceFrame(f: Frame, now: number, buckets: ReadonlySet<Bucket>, globe: boolean, center: LngLatTuple): void {
  const want = WANT;
  for (let b = 0; b < BUCKETS.length; b++) want[b] = buckets.has(BUCKETS[b]!) ? 1 : 0;
  const cφ = Math.cos(center[1] * D2R);
  const cx = cφ * Math.cos(center[0] * D2R);
  const cy = cφ * Math.sin(center[0] * D2R);
  const cz = Math.sin(center[1] * D2R);
  const nowS = now / 1000;
  let n = 0;
  let changed = false;
  let froze = false;
  let stale = 0;
  for (let i = 0; i < f.records.length; i++) {
    const b = f.bucket[i]!;
    if (!want[b]) continue;
    if (globe && f.unit[i * 3]! * cx + f.unit[i * 3 + 1]! * cy + f.unit[i * 3 + 2]! * cz < COS_FACING) continue;
    if (f.visible[n] !== i) {
      f.visible[n] = i;
      changed = true;
    }
    n++;
    if (f.settled[i]) {
      if (f.frozen[i]) stale++;
      continue;
    }
    const age = Math.max(0, nowS - f.seen[i]!);
    reckon(f, i, Math.min(age, MAX_DEAD_RECKON_S));
    if (age > MAX_DEAD_RECKON_S) {
      f.frozen[i] = 1;
      f.settled[i] = 1;
      froze = true;
      stale++;
    }
  }
  f.staleVisible = stale;
  if (n !== f.count || changed) {
    f.count = n;
    f.visVersion++;
    f.data = { length: n };
  }
  if (froze) f.frozenVersion++;
}

export interface H3Cell {
  hex: string;
  count: number;
}

export function aggregateH3(f: Frame): H3Cell[] {
  const counts = new Map<string, number>();
  for (let k = 0; k < f.count; k++) {
    const i = f.visible[k]!;
    const cell = latLngToCell(f.pos[i * 2 + 1]!, f.pos[i * 2]!, H3_RES);
    counts.set(cell, (counts.get(cell) ?? 0) + 1);
  }
  return [...counts].map(([hex, count]) => ({ hex, count }));
}

function mix(a: Rgba, b: Rgba, t: number): Rgba {
  return [0, 1, 2, 3].map((i) => Math.round(a[i]! + (b[i]! - a[i]!) * t)) as Rgba;
}

function bucketColors(): Record<Bucket, Rgba> {
  const out = {} as Record<Bucket, Rgba>;
  for (const [bucket, layer] of Object.entries(BUCKET_LAYER) as [Bucket, LayerId][]) {
    out[bucket] = readCssColor((getLayer(layer)?.colorToken ?? '--map-flight-unknown') as MapToken);
  }
  return out;
}

export interface BuildOptions {
  frame: Frame;
  view: View;
  /** Monotonic counter: bumps updateTriggers for positions/colours. */
  tick: number;
  /** New snapshot counter (icons/sizes only change with data). */
  dataVersion: number;
  colorMode: 'bucket' | 'altitude';
  theme: string;
  watched: readonly string[];
  tracks: ReadonlyMap<string, readonly TrackPoint[]>;
  selectedId: string | null;
  /** H3 cells when the aggregate replaces icons. */
  cells: H3Cell[] | null;
  /** Selection for a picked aircraft (the map's click router opens it; see select.ts). */
  toSelection: (r: FlightRecord, lngLat: [number, number]) => Selection;
}

export function buildLayers(o: BuildOptions): LayersList | null {
  const f = o.frame;
  if (!f.records.length) return null;
  const colors = bucketColors();
  const ramp = { ground: readCssColor('--map-flight-unknown'), low: readCssColor('--map-alt-low'), high: readCssColor('--map-alt-high') };
  const emergency = readCssColor('--map-flight-emergency');
  const watchColor = readCssColor('--map-flight-watch');
  const colorOf = (r: FlightRecord): Rgba => {
    if (o.colorMode === 'altitude') return r.onGround ? ramp.ground : mix(ramp.low, ramp.high, altitudeRamp(r.altFt));
    return colors[r.bucket];
  };
  const rec = (index: number) => f.records[f.visible[index]!]!;
  const at = (index: number, target: number[]) => {
    const i = f.visible[index]!;
    target[0] = f.pos[i * 2]!;
    target[1] = f.pos[i * 2 + 1]!;
    return target as [number, number];
  };
  const { bearing, zoom } = o.view;
  const scale = zoom < 3 ? 0.55 : zoom < 5 ? 0.7 : zoom < 7 ? 0.85 : 1;
  const out: LayersList = [];

  if (o.cells) {
    const max = Math.max(1, ...o.cells.map((c) => c.count));
    const base = colors.commercial;
    out.push(
      new H3HexagonLayer<H3Cell>({
        id: 'aviation-h3',
        data: o.cells,
        getHexagon: (d) => d.hex,
        getFillColor: (d) => [base[0], base[1], base[2], Math.round(40 + 190 * Math.sqrt(d.count / max))],
        extruded: false,
        stroked: false,
        pickable: false,
        parameters: { cullMode: 'none' },
        updateTriggers: { getFillColor: [o.theme] },
      }),
    );
  } else {
    const atlas = aircraftAtlas();
    if (atlas) {
      out.push(
        new SdfIconLayer({
          id: 'aviation-icons',
          data: f.data,
          iconAtlas: atlas.canvas as unknown as string,
          iconMapping: atlas.mapping,
          getIcon: (_: unknown, { index }: { index: number }) => iconFor(rec(index)),
          getPosition: (_: unknown, { index, target }: { index: number; target: number[] }) => at(index, target),
          getAngle: (_: unknown, { index }: { index: number }) => bearing - (rec(index).trackDeg ?? 0),
          getColor: (_: unknown, { index }: { index: number }) => {
            const c = colorOf(rec(index));
            // Past the 60 s dead-reckoning cap the aircraft is frozen: drawn dimmer (stale).
            return f.frozen[f.visible[index]!] ? ([Math.round(c[0] * 0.55), Math.round(c[1] * 0.55), Math.round(c[2] * 0.55), 255] as Rgba) : c;
          },
          getSize: (_: unknown, { index }: { index: number }) => (rec(index).isHelicopter ? 26 : 24),
          sizeUnits: 'pixels',
          sizeScale: scale,
          billboard: true,
          alphaCutoff: 0.2,
          pickable: true,
          parameters: ICON_PARAMETERS,
          // Read by the map's click/hover router (src/lib/map/picking.ts); no own onClick handler,
          // so a GPU pick and the CPU hit-test of the same aircraft still open one card.
          toSelection: (info: PickingInfo) => (info.index < 0 ? null : o.toSelection(rec(info.index), at(info.index, [0, 0]))),
          // Positions move every tick; everything else only when the snapshot, the visible list,
          // the frozen set or the view settings change (no per-second O(n) accessor re-runs).
          updateTriggers: {
            getPosition: [o.tick],
            getAngle: [o.dataVersion, f.visVersion, bearing],
            getColor: [o.dataVersion, f.visVersion, f.frozenVersion, o.colorMode, o.theme],
            getIcon: [o.dataVersion, f.visVersion],
            getSize: [o.dataVersion, f.visVersion],
          },
        }),
      );
    }
  }

  const ringKey = `${o.dataVersion}|${f.visVersion}|${o.selectedId ?? ''}|${o.watched.join(',')}`;
  if (f.rings?.key !== ringKey) {
    const emergencies: number[] = [];
    const highlighted: number[] = [];
    for (let k = 0; k < f.count; k++) {
      const r = f.records[f.visible[k]!]!;
      if (r.emergency) emergencies.push(k);
      if (r.id === o.selectedId || o.watched.includes(r.id)) highlighted.push(k);
    }
    f.rings = { key: ringKey, emergencies, highlighted };
  }
  const { emergencies, highlighted } = f.rings;
  const ring = (id: string, data: number[], color: Rgba, radius: number, width: number) =>
    new ScatterplotLayer<number>({
      id,
      data,
      getPosition: (k: number, { target }: { target: number[] }) => at(k, target),
      getRadius: radius,
      radiusUnits: 'pixels',
      stroked: true,
      filled: false,
      getLineColor: color,
      lineWidthUnits: 'pixels',
      getLineWidth: width,
      billboard: true,
      parameters: ICON_PARAMETERS,
      updateTriggers: { getPosition: [o.tick], getLineColor: [o.theme] },
    });
  // Emergency squawks (7500 / 7600 / 7700): a red ring; watched/selected aircraft: an amber ring.
  if (emergencies.length) out.push(ring('aviation-emergency', emergencies, emergency, 17, 2.5));
  if (highlighted.length) out.push(ring('aviation-highlight', highlighted, watchColor, 21, 1.5));

  // Trails for watched aircraft: current leg of the flown track + the live dead-reckoned head.
  const paths: { path: LngLatTuple[] }[] = [];
  for (const hex of o.watched) {
    const track = o.tracks.get(hex);
    if (!track?.length) continue;
    const pts: LngLatTuple[] = track.map((p) => [p.lng, p.lat]);
    f.idIndex ??= new Map(f.records.map((r, i) => [r.id, i]));
    const live = f.idIndex.get(hex) ?? -1;
    if (live >= 0) pts.push([f.pos[live * 2]!, f.pos[live * 2 + 1]!]);
    for (const seg of splitAtAntimeridian(pts)) paths.push({ path: seg });
  }
  if (paths.length) {
    out.unshift(
      new PathLayer<{ path: LngLatTuple[] }>({
        id: 'aviation-trails',
        data: paths,
        getPath: (d) => d.path,
        getColor: watchColor,
        getWidth: 2,
        widthUnits: 'pixels',
        capRounded: true,
        jointRounded: true,
        parameters: { cullMode: 'none' },
        updateTriggers: { getPath: [o.tick], getColor: [o.theme] },
      }),
    );
  }
  return out;
}
