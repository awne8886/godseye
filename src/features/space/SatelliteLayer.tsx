'use client';
/**
 * Satellites on the globe: the propagation worker fetches and parses the OMM catalogue itself
 * (the main thread never parses or clones it) and posts typed arrays; this component publishes
 * deck.gl layers from them (binary attributes, no per-frame React state beyond the layer list). Mission colours come from `--map-sat-*` tokens; satellites in
 * Earth's shadow are dimmed; the ISS and the selected satellite are enlarged; the selected
 * satellite's orbit (±½ period) is drawn at the same compressed altitude as the markers.
 * Owner: layers-space.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { IconLayer, PathLayer, TextLayer, type IconLayerProps } from '@deck.gl/layers';
import type { GetPickingInfoParams, LayersList, PickingInfo } from '@deck.gl/core';
import type { LayerComponentProps } from '@/lib/feature-module';
import { type Selection, useDeckLayers, useLayerStatusStore, useMapInstance, useMapInstanceStore, useSelectionStore } from '@/lib/layer-host';
import { useUiStore } from '@/lib/store';
import { useStyleVersion } from '@/lib/map/style-version';
import { readCssColor } from '@/lib/tokens';
import type { LayerId } from '@/lib/layer-registry';
import { CATEGORY_TOKEN, LAYER_CATEGORY, SAT_CATEGORIES } from './lib/catalog';
import { ISS_NORAD_ID, displayAltM } from './lib/orbit-math';
import type { WorkerIn, WorkerOut } from './lib/propagator';
import type { BatchResult } from './lib/propagate-batch';
import { SatelliteScreenCache, hitTestSatellites, latestPosition, prewarmScreenTable, type PickView, type ProjectMap } from './client/pick';
import { afterIdle } from '@/lib/map/defer';
import { registerDeckPick, registerHitTester, type DeckPickInfo } from '@/lib/map/picking';
import { cameraFromMap, getFarSideCamera, isFacing, type CameraMapLike } from '@/lib/map/far-side';
import { catalogue, fetchOrbit, indexOfId, orbitQueryKey, recordAt, selectionDataFor, setCatalogue, useSpaceStore, type SatelliteSelectionData } from './client/data';
import type { Attribution, SatCategory } from '@/lib/types';
import { hudFontFamily } from '@/lib/tokens';
import { createBoundaryPublisher, startAlignedTicks } from './lib/second-clock';
import type { CatalogueSummary } from './lib/propagator';
import { buildGlyphAtlas, type GlyphAtlas } from './lib/glyphs';

const REFRESH_MS = 120 * 60_000;
/** While the SatNOGS fallback is served, ask again this soon (the server retries CelesTrak on a back-off). */
const FALLBACK_REFRESH_MS = 5 * 60_000;
/** After a failed catalogue load (SOURCE OFFLINE), ask again after this long. */
const RETRY_MS = 60_000;
const TICK_MS = 1000;
const TICK_MS_REDUCED = 2000;
/**
 * Ticks are requested this long before each wall-clock second, and the frame is published AT the
 * second (propagation takes 60–90 ms for 16.6k objects, perf round 4), so the satellites redraw on
 * the same boundary as every other 1 Hz layer instead of at an arbitrary phase.
 */
const TICK_LEAD_MS = 250;
/** The ISS label's glyphs: a full ASCII atlas is never built for three letters. */
export const ISS_LABEL = 'ISS';
export const ISS_LABEL_CHARSET = [...new Set(ISS_LABEL)];
const DECK_Z = 90;
const DOTS_ID = 'space-satellites';
const ORBIT_REANCHOR_MS = 10 * 60_000;
/** While the map moves, the far-side camera reaches the worker at most this often (and on moveend). */
const CAMERA_POST_MS = 100;

/** A propagated frame from the worker (far-side filtered with `camera`). */
type Frame = { version: string } & BatchResult;

/**
 * Diagnostics for e2e (hidden): the frame on screen — catalogue version, propagation time, drawn
 * and hidden counts and the far-side camera it was filtered with — so a spec can re-propagate the
 * same catalogue and check that exactly the camera-facing satellites are drawn.
 */
export function frameDiagnostics(f: Frame | null): string {
  if (!f) return '';
  return JSON.stringify({ version: f.version, at: f.at, count: f.count, hidden: f.hidden, failed: f.failed, camera: f.camera });
}

/**
 * The satellites are binary attributes, so deck.gl leaves `info.object` empty and the map's click
 * router would drop the pick; expose the drawn row index (in the whole frame, not this category's
 * slice) as the picked object.
 */
class SatelliteIconLayer extends IconLayer<unknown, { drawnFrame: Frame; drawOffset: number }> {
  static override layerName = 'SatelliteIconLayer';
  override getPickingInfo(params: GetPickingInfoParams): PickingInfo {
    const info = super.getPickingInfo(params);
    if (info.index >= 0 && (info.object === undefined || info.object === null)) info.object = { drawIndex: this.props.drawOffset + info.index };
    return info;
  }
}

/** Per-frame update trigger: a camera re-filter keeps `at` but changes the drawn set. */
const frameSeq = new WeakMap<Frame, number>();
let nextSeq = 0;
function seqOf(f: Frame): number {
  let s = frameSeq.get(f);
  if (s === undefined) {
    s = ++nextSeq;
    frameSeq.set(f, s);
  }
  return s;
}

/** deck layer id of one mission category's glyphs. */
export const satelliteLayerId = (cat: SatCategory): string => `${DOTS_ID}-${cat}`;


let atlasCache: { image: ImageData; mapping: GlyphAtlas['mapping'] } | null = null;
/** The glyph atlas, rasterised once per page (one object identity, so deck.gl never re-uploads it). */
function glyphAtlas(): { image: ImageData; mapping: GlyphAtlas['mapping'] } {
  if (!atlasCache) {
    const a = buildGlyphAtlas();
    atlasCache = { image: new ImageData(a.data as Uint8ClampedArray<ArrayBuffer>, a.width, a.height), mapping: a.mapping };
  }
  return atlasCache;
}

/**
 * The satellites: one IconLayer per mission category (the glyph is a constant `getIcon`, which
 * IconLayer cannot take as a binary attribute) over `subarray` views of the worker frame, whose
 * rows arrive sorted by category with `categoryOffsets`. The six layers are always published
 * (empty ones invisible) so their GPU state survives a category toggle. Billboarded, never culled
 * (MapLibre leaves face culling on after the globe pass) and drawn with `depthCompare: 'always'`:
 * the worker's far-side filter (isFacing at the drawn altitude) already dropped every satellite
 * behind the globe, and the camera re-filter reaches the worker within 100 ms of a move.
 */
export function satelliteIconLayers(frame: Frame, atlas: { image: unknown; mapping: GlyphAtlas['mapping'] }): SatelliteIconLayer[] {
  const seq = seqOf(frame);
  const offs = frame.categoryOffsets;
  return SAT_CATEGORIES.map((cat, c) => {
    const start = offs[c] ?? 0;
    const end = offs[c + 1] ?? start;
    const n = end - start;
    return new SatelliteIconLayer({
      id: satelliteLayerId(cat),
      data: {
        length: n,
        attributes: {
          getPosition: { value: frame.positions.subarray(start * 3, end * 3), size: 3 },
          getColor: { value: frame.colors.subarray(start * 4, end * 4), size: 4, type: 'unorm8' },
          getSize: { value: frame.sizes.subarray(start, end), size: 1 },
        },
      },
      // An ImageData (deck.gl uploads browser image objects; the prop type names only Texture | URL).
      iconAtlas: atlas.image as IconLayerProps['iconAtlas'],
      iconMapping: atlas.mapping,
      // Constant per layer: deck.gl resolves a non-function accessor once (no per-row call).
      getIcon: cat as unknown as () => string,
      sizeUnits: 'pixels',
      billboard: true,
      visible: n > 0,
      pickable: true,
      parameters: { cullMode: 'none', depthCompare: 'always' },
      // Read by the map's single click/hover router (src/lib/map/picking.ts), which arbitrates
      // with every other module (aircraft and cameras outrank satellites) and opens one card.
      drawnFrame: frame,
      drawOffset: start,
      updateTriggers: { getPosition: seq, getColor: seq, getSize: seq },
    });
  });
}

/** The frame and frame-wide row a GPU pick on one of the category layers refers to (null: not a drawn satellite). */
export function pickedRow(info: DeckPickInfo): { frame: Frame; row: number } | null {
  const f = (info.layer?.props as { drawnFrame?: Frame } | undefined)?.drawnFrame;
  const i = (info.object as { drawIndex?: number } | null | undefined)?.drawIndex ?? -1;
  if (!f || !Number.isInteger(i) || i < 0 || i >= f.count) return null;
  return { frame: f, row: i };
}

/** Selection for catalogue row `catIndex` drawn at `lngLat` in the frame propagated for `at`. */
export function selectionFor(catIndex: number, lngLat: [number, number], at: number, active: ReadonlySet<LayerId>): Selection | null {
  const rec = recordAt(catIndex);
  if (!rec) return null;
  const layer: LayerId = active.has('satellites') ? 'satellites' : ((Object.entries(LAYER_CATEGORY).find(([, c]) => c === rec.category)?.[0] as LayerId | undefined) ?? 'satellites');
  return {
    kind: 'satellite',
    id: String(rec.noradId),
    layer,
    source: catalogue()?.source === 'satnogs-fallback' ? 'satnogs' : 'celestrak',
    observedAt: rec.epoch,
    data: selectionDataFor(rec, at),
    lngLat,
  };
}

/** Categories to draw for the active toggles: "All Satellites" draws every category. */
export function visibleCategories(active: ReadonlySet<LayerId>): number[] {
  if (active.has('satellites')) return SAT_CATEGORIES.map((_, i) => i);
  const out: number[] = [];
  for (const [layer, cat] of Object.entries(LAYER_CATEGORY)) if (active.has(layer as LayerId)) out.push(SAT_CATEGORIES.indexOf(cat));
  return out;
}

type Rgba = [number, number, number, number];

/** The selected satellite's orbit (±½ period) at the markers' compressed altitude; antialiased, never culled. */
export function orbitLayer(segments: readonly (readonly (readonly [number, number, number])[])[], color: Rgba): PathLayer<{ path: [number, number, number][] }> {
  return new PathLayer<{ path: [number, number, number][] }>({
    id: 'space-orbit',
    data: segments.map((seg) => ({ path: seg.map(([lng, lat, alt]) => [lng, lat, displayAltM(alt)] as [number, number, number]) })),
    getPath: (d) => d.path,
    getColor: color,
    getWidth: 1.5,
    widthUnits: 'pixels',
    antialiasing: true,
    parameters: { cullMode: 'none' },
    pickable: false,
  });
}

/** "ISS" beside its marker; the glyph atlas holds only the label's letters. */
export function issLabelLayer(p: [number, number, number], color: Rgba): TextLayer<{ p: [number, number, number] }> {
  return new TextLayer<{ p: [number, number, number] }>({
    id: 'space-iss-label',
    data: [{ p }],
    getPosition: (d) => d.p,
    getText: () => ISS_LABEL,
    getColor: color,
    getSize: 11,
    fontFamily: hudFontFamily(),
    characterSet: ISS_LABEL_CHARSET,
    getPixelOffset: [0, -16],
    billboard: true,
    parameters: { cullMode: 'none', depthCompare: 'always' },
    pickable: false,
  });
}

function palette(): [number, number, number, number][] {
  return SAT_CATEGORIES.map((c) => readCssColor(CATEGORY_TOKEN[c], 0.95));
}

/**
 * Rail attribution for the catalogue in use. The SatNOGS fallback is named as such (with its size
 * and why), so the rail never shows a fallback as if it were the CelesTrak catalogue.
 */
export function railAttribution(summary: Pick<CatalogueSummary, 'catalogueSource' | 'meta' | 'total'>): Attribution[] {
  const all = summary.meta.attribution ?? [];
  if (summary.catalogueSource === 'satnogs-fallback') {
    const sn = all.find((a) => /satnogs/i.test(a.text));
    return [
      {
        text: `FALLBACK · SatNOGS DB TLEs, ${summary.total.toLocaleString('en-US')} objects (CelesTrak unavailable; retrying)`,
        ...(sn?.url ? { url: sn.url } : {}),
        ...(sn?.licence ? { licence: sn.licence } : {}),
      },
    ];
  }
  return all.filter((a) => !/satnogs/i.test(a.text));
}

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

function subscribeReduced(cb: () => void): () => void {
  const mq = window.matchMedia(REDUCED_QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

/** The hit-test view for the current camera (the hover and the idle prewarm must agree on it). */
function pickView(globe: boolean, m: CameraMapLike): PickView {
  return { globe, camera: globe ? (getFarSideCamera() ?? cameraFromMap(m)) : null };
}

/** Upper bound on waiting for idle time before projecting a new frame for the hit-test (frames are 1 s apart). */
const PREWARM_IDLE_TIMEOUT_MS = 500;

function useReducedMotion(): boolean {
  const pref = useUiStore((s) => s.settings.motion);
  const system = useSyncExternalStore(subscribeReduced, () => window.matchMedia(REDUCED_QUERY).matches, () => false);
  return pref === 'reduced' || (pref === 'system' && system);
}

export default function SatelliteLayer({ active }: LayerComponentProps) {
  const map = useMapInstance();
  const projection = useMapInstanceStore((s) => s.projection);
  const theme = useUiStore((s) => s.theme);
  // Style Studio / Ghost Protocol rewrite `--map-sat-*` without touching `theme`: re-post the palette.
  const styleVersion = useStyleVersion();
  const selection = useSelectionStore((s) => s.selection);
  const updateStatus = useLayerStatusStore((s) => s.update);
  const setFrame = useSpaceStore((s) => s.setFrame);
  const catalogueVersion = useSpaceStore((s) => s.catalogueVersion);
  const reduced = useReducedMotion();
  const workerRef = useRef<Worker | null>(null);
  const [frame, setFrameState] = useState<Frame | null>(null);
  /** Newest frame, read by the pickers (the layer's own closure may be one tick older). */
  const latestFrame = useRef<Frame | null>(null);
  const activeRef = useRef(active);
  const globeRef = useRef(projection === 'globe');
  const selectedId = selection?.kind === 'satellite' ? Number(selection.id) : null;
  const visible = useMemo(() => visibleCategories(active), [active]);

  useEffect(() => {
    activeRef.current = active;
    globeRef.current = projection === 'globe';
  }, [active, projection]);

  // Worker lifecycle: the worker fetches /api/satellites itself (now and every 2 h; 60 s after a failure).
  useEffect(() => {
    const w = new Worker(new URL('../../workers/tle-propagate.ts', import.meta.url), { type: 'module', name: 'tle-propagate' });
    workerRef.current = w;
    const url = new URL('/api/satellites', window.location.href).href;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = (delay: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => w.postMessage({ type: 'load', url } satisfies WorkerIn), delay);
    };
    updateStatus('satellites', { state: 'loading' });
    w.postMessage({ type: 'load', url } satisfies WorkerIn);
    // Frames are propagated for the next wall-clock second and published at that second. A
    // camera re-filter of the same propagation does not touch the card's telemetry store.
    let telemetryKey = '';
    const publisher = createBoundaryPublisher<Frame>((f) => {
      latestFrame.current = f;
      setFrameState(f);
      const key = `${f.at}|${f.selected?.noradId ?? ''}`;
      if (key === telemetryKey) return;
      telemetryKey = key;
      setFrame(f.at, f.selected ? { ...f.selected, at: f.at } : null);
    });
    w.onmessage = (e: MessageEvent<WorkerOut>) => {
      const msg = e.data;
      if (msg.type === 'frame') {
        const f = msg as Frame;
        publisher.offer(f, f.at);
      } else if (msg.type === 'catalogue') {
        setCatalogue(msg.version, msg.summary, msg.packed);
        const d = msg.summary;
        const base = { state: d.meta.state, fetchedAt: d.meta.fetchedAt, observedAt: d.meta.observedAt, lastGoodAt: d.meta.lastGoodAt, providers: d.providers, attribution: railAttribution(d) };
        updateStatus('satellites', { ...base, count: d.total, categoryCounts: d.categoryCounts, error: undefined });
        for (const [layer, cat] of Object.entries(LAYER_CATEGORY)) updateStatus(layer as LayerId, { ...base, count: d.categoryCounts[cat as SatCategory] ?? 0, error: undefined });
        load(d.catalogueSource === 'satnogs-fallback' ? FALLBACK_REFRESH_MS : REFRESH_MS);
      } else if (msg.type === 'catalogue-error') {
        // Keep drawing the last catalogue the worker holds (its epoch is on every card); the badge says offline.
        const meta = msg.meta;
        const patch = { state: 'offline' as const, count: null, fetchedAt: meta?.fetchedAt ?? null, observedAt: meta?.observedAt ?? null, lastGoodAt: meta?.lastGoodAt ?? null, error: 'SOURCE OFFLINE' };
        updateStatus('satellites', patch);
        for (const layer of Object.keys(LAYER_CATEGORY)) updateStatus(layer as LayerId, patch);
        load(RETRY_MS);
      }
    };
    return () => {
      clearTimeout(timer);
      publisher.cancel();
      w.terminate();
      workerRef.current = null;
    };
  }, [setFrame, updateStatus]);

  // CPU hit-test on the newest frame (reliable on a moving marker and where GPU picking is
  // unavailable). Satellites behind the globe for the CURRENT camera are never hit. The host
  // runs it on every pointer-move frame: the screen cache projects the frame once per (frame,
  // camera) and every other hover is a scan (verification round 8: 33 ms → a scan per hover).
  // The table itself is built in idle time when each frame arrives (prewarm effect below).
  const screenRef = useRef<SatelliteScreenCache | null>(null);
  screenRef.current ??= new SatelliteScreenCache();
  useEffect(() => {
    const screen = screenRef.current!;
    const off = registerHitTester('space', (point, m) =>
      hitTestSatellites(
        latestFrame.current,
        point,
        m,
        pickView(globeRef.current, m),
        (catIndex, lngLat) => {
          const s = selectionFor(catIndex, lngLat, latestFrame.current?.at ?? Date.now(), activeRef.current);
          return s ? { layer: s.layer ?? 'satellites', selection: s } : null;
        },
        screen,
      ),
    );
    return () => {
      off();
      screen.clear();
    };
  }, []);

  // Project each new frame for the hover hit-test while the browser is idle (not inside the first
  // hover after the frame). Skipped while the camera moves or the page is hidden.
  useEffect(() => {
    if (!map || !frame) return;
    const m = map as unknown as ProjectMap & CameraMapLike & { isMoving?: () => boolean };
    return prewarmScreenTable(
      screenRef.current!,
      m,
      { frame: () => latestFrame.current, view: () => pickView(globeRef.current, m), moving: () => m.isMoving?.() ?? false, hidden: () => document.hidden },
      (cb) => afterIdle(cb, PREWARM_IDLE_TIMEOUT_MS),
    );
  }, [map, frame]);

  // GPU pick → selection (the map's click router calls it for each 'space-satellites-<category>'
  // layer). The picked `drawIndex` belongs to the frame that layer instance drew; the card opens at the satellite's position in
  // the NEWEST frame (the marker moves every tick).
  useEffect(() => {
    const resolve = (info: DeckPickInfo): Selection | null => {
      const picked = pickedRow(info);
      if (!picked) return null;
      const { frame: f, row: i } = picked;
      const catIndex = f.index[i]!;
      const p = latestPosition(latestFrame.current, catIndex) ?? [f.positions[i * 3]!, f.positions[i * 3 + 1]!, f.positions[i * 3 + 2]!];
      // GPU picking draws its own buffer without the globe's depth: re-check the far side.
      if (globeRef.current && !isFacing([p[0], p[1]], getFarSideCamera(), p[2])) return null;
      return selectionFor(catIndex, [p[0], p[1]], latestFrame.current?.at ?? f.at, activeRef.current);
    };
    const offs = SAT_CATEGORIES.map((cat) => registerDeckPick(satelliteLayerId(cat), resolve));
    return () => offs.forEach((off) => off());
  }, []);

  // View (far-side camera, visible categories, palette, selection) → worker.
  useEffect(() => {
    const w = workerRef.current;
    if (!w) return;
    const camera = projection === 'globe' ? (map ? cameraFromMap(map) : getFarSideCamera()) : null;
    w.postMessage({ type: 'view', camera, visible, palette: palette(), selectedId } satisfies WorkerIn);
  }, [map, projection, visible, selectedId, theme, styleVersion, catalogueVersion]);

  // Far-side camera → worker while the map moves (at most every CAMERA_POST_MS, and once when it
  // settles). The worker re-filters its newest propagation at once, so satellites that turn
  // behind the globe stop drawing (and picking) without waiting for the next 1 Hz tick.
  useEffect(() => {
    if (!map || projection !== 'globe') return;
    let pending: ReturnType<typeof setTimeout> | undefined;
    let last = 0;
    const send = () => {
      last = Date.now();
      workerRef.current?.postMessage({ type: 'camera', camera: cameraFromMap(map) } satisfies WorkerIn);
    };
    const onMove = () => {
      if (pending) return;
      pending = setTimeout(
        () => {
          pending = undefined;
          send();
        },
        Math.max(0, CAMERA_POST_MS - (Date.now() - last)),
      );
    };
    const onEnd = () => {
      if (pending) clearTimeout(pending);
      pending = undefined;
      send();
    };
    map.on('move', onMove);
    map.on('moveend', onEnd);
    return () => {
      map.off('move', onMove);
      map.off('moveend', onEnd);
      if (pending) clearTimeout(pending);
    };
  }, [map, projection]);

  // 1 Hz propagation clock (0.5 Hz with reduced motion) on wall-clock second boundaries; paused
  // while the tab is hidden. The first frame is propagated for "now" so nothing waits a second.
  useEffect(() => {
    const request = (at: number) => {
      if (document.hidden) return;
      workerRef.current?.postMessage({ type: 'tick', at } satisfies WorkerIn);
    };
    request(Date.now());
    return startAlignedTicks(request, { periodMs: reduced ? TICK_MS_REDUCED : TICK_MS, leadMs: TICK_LEAD_MS });
  }, [reduced, catalogueVersion]);

  // Orbit for the selected satellite, anchored on the frame its marker was drawn for.
  // The Earth turns under a fixed track, so after 10 minutes the track is re-anchored on a
  // 10-minute boundary (one request per satellite per 10 min, shared by every viewer via the CDN).
  const selData = selection?.kind === 'satellite' ? (selection.data as SatelliteSelectionData) : null;
  const frameAt = frame?.at ?? null;
  const anchor = selData ? (frameAt !== null && frameAt - selData.anchorAt > ORBIT_REANCHOR_MS ? Math.floor(frameAt / ORBIT_REANCHOR_MS) * ORBIT_REANCHOR_MS : selData.anchorAt) : 0;
  const orbit = useQuery({
    queryKey: selData ? orbitQueryKey(selData.noradId, anchor) : ['space', 'orbit', 'none'],
    queryFn: () => fetchOrbit(selData!.noradId, anchor),
    enabled: !!selData,
    staleTime: 10 * 60_000,
    retry: 1,
  });

  const layers = useMemo<LayersList | null>(() => {
    if (!frame) return null;
    const out: LayersList = [];
    if (orbit.data && selData && orbit.data.noradId === selData.noradId) {
      out.push(orbitLayer(orbit.data.segments, readCssColor(CATEGORY_TOKEN[selData.category], 0.85)));
    }
    out.push(...satelliteIconLayers(frame, glyphAtlas()));
    // ISS highlight: a label beside its (enlarged) marker when it is on the visible hemisphere.
    const issIdx = indexOfId(ISS_NORAD_ID);
    const k = issIdx === undefined ? -1 : frame.index.indexOf(issIdx);
    if (k >= 0) {
      out.push(issLabelLayer([frame.positions[k * 3]!, frame.positions[k * 3 + 1]!, frame.positions[k * 3 + 2]!], readCssColor('--map-sat-science', 1)));
    }
    return out;
    // Re-read the orbit / ISS label tokens on Style Studio / Ghost Protocol changes.
  }, [frame, orbit.data, selData, styleVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  useDeckLayers('space', layers, DECK_Z);
  const diagnostics = useMemo(() => frameDiagnostics(frame), [frame]);
  return <p hidden data-testid="space-status" data-frame={diagnostics} />;
}
