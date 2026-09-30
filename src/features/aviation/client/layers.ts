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
import { isFacing, splitAtAntimeridian, type LngLatTuple } from '@/lib/geo';
import { readCssColor, type MapToken, type Rgba } from '@/lib/tokens';
import type { Selection } from '@/lib/layer-host';
import type { FlightRecord } from '../adsb';
import type { Bucket } from '../classify';
import { deadReckon } from '../codec';
import type { TrackPoint } from '../trace';
import { aircraftAtlas } from './icons';
import { SdfIconLayer } from './SdfIconLayer';
import { BUCKET_LAYER } from './useFlights';
import { altitudeRamp, iconFor } from './format';

export const AGGREGATE_ABOVE = 20_000;
export const AGGREGATE_BELOW_ZOOM = 4;
const H3_RES = 3;

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
}

export function newFrame(records: FlightRecord[]): Frame {
  return { records, pos: new Float64Array(records.length * 2), frozen: new Uint8Array(records.length), visible: new Uint32Array(records.length), count: 0 };
}

/** Dead-reckon every record to `now` and rebuild the visible index (active buckets, camera-facing side of the globe). */
export function advanceFrame(f: Frame, now: number, buckets: ReadonlySet<Bucket>, globe: boolean, center: LngLatTuple): void {
  let n = 0;
  for (let i = 0; i < f.records.length; i++) {
    const r = f.records[i]!;
    const p = deadReckon(r, now);
    f.pos[i * 2] = p.lng;
    f.pos[i * 2 + 1] = p.lat;
    f.frozen[i] = p.frozen ? 1 : 0;
    if (!buckets.has(r.bucket)) continue;
    if (globe && !isFacing(center, [p.lng, p.lat], 88)) continue;
    f.visible[n++] = i;
  }
  f.count = n;
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
          data: { length: f.count },
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
          parameters: { depthCompare: 'always' },
          // Read by the map's click/hover router (src/lib/map/picking.ts); no own onClick handler,
          // so a GPU pick and the CPU hit-test of the same aircraft still open one card.
          toSelection: (info: PickingInfo) => (info.index < 0 ? null : o.toSelection(rec(info.index), at(info.index, [0, 0]))),
          updateTriggers: {
            getPosition: [o.tick],
            getAngle: [o.tick, bearing],
            getColor: [o.tick, o.colorMode, o.theme],
            getIcon: [o.tick],
            getSize: [o.tick],
          },
        }),
      );
    }
  }

  const emergencies: number[] = [];
  const highlighted: number[] = [];
  for (let k = 0; k < f.count; k++) {
    const r = f.records[f.visible[k]!]!;
    if (r.emergency) emergencies.push(k);
    if (r.id === o.selectedId || o.watched.includes(r.id)) highlighted.push(k);
  }
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
      parameters: { depthCompare: 'always' },
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
    const live = f.records.findIndex((r) => r.id === hex);
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
