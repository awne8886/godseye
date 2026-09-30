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
import { PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { GetPickingInfoParams, LayersList, PickingInfo } from '@deck.gl/core';
import type { LayerComponentProps } from '@/lib/feature-module';
import { type Selection, useDeckLayers, useLayerStatusStore, useMapInstance, useMapInstanceStore, useSelectionStore } from '@/lib/layer-host';
import { useUiStore } from '@/lib/store';
import { readCssColor } from '@/lib/tokens';
import type { LayerId } from '@/lib/layer-registry';
import { CATEGORY_TOKEN, LAYER_CATEGORY, SAT_CATEGORIES } from './lib/catalog';
import { ISS_NORAD_ID, displayAltM } from './lib/orbit-math';
import type { WorkerIn, WorkerOut } from './lib/propagator';
import { hitTestSatellites, latestLngLat } from './client/pick';
import { registerDeckPick, registerHitTester, type DeckPickInfo } from '@/lib/map/picking';
import { catalogue, fetchOrbit, indexOfId, orbitQueryKey, recordAt, selectionDataFor, setCatalogue, useSpaceStore, type SatelliteSelectionData } from './client/data';
import type { SatCategory } from '@/lib/types';

const REFRESH_MS = 120 * 60_000;
/** After a failed catalogue load (SOURCE OFFLINE), ask again after this long. */
const RETRY_MS = 60_000;
const TICK_MS = 1000;
const TICK_MS_REDUCED = 2000;
const DECK_Z = 90;
const DOTS_ID = 'space-satellites';
const ORBIT_REANCHOR_MS = 10 * 60_000;

interface Frame {
  version: string;
  at: number;
  count: number;
  positions: Float32Array;
  colors: Uint8Array;
  radii: Float32Array;
  index: Uint32Array;
  hidden: number;
  failed: number;
  selected: { noradId: number; lng: number; lat: number; altKm: number; velocityKmS: number; shadow: boolean } | null;
}

/**
 * The satellites are binary attributes, so deck.gl leaves `info.object` empty and the map's click
 * router would drop the pick; expose the drawn row index as the picked object.
 */
class SatelliteDotsLayer extends ScatterplotLayer<unknown, { drawnFrame: Frame }> {
  static override layerName = 'SatelliteDotsLayer';
  override getPickingInfo(params: GetPickingInfoParams): PickingInfo {
    const info = super.getPickingInfo(params);
    if (info.index >= 0 && (info.object === undefined || info.object === null)) info.object = { drawIndex: info.index };
    return info;
  }
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

function palette(): [number, number, number, number][] {
  return SAT_CATEGORIES.map((c) => readCssColor(CATEGORY_TOKEN[c], 0.95));
}

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

function subscribeReduced(cb: () => void): () => void {
  const mq = window.matchMedia(REDUCED_QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

function useReducedMotion(): boolean {
  const pref = useUiStore((s) => s.settings.motion);
  const system = useSyncExternalStore(subscribeReduced, () => window.matchMedia(REDUCED_QUERY).matches, () => false);
  return pref === 'reduced' || (pref === 'system' && system);
}

export default function SatelliteLayer({ active }: LayerComponentProps) {
  const map = useMapInstance();
  const projection = useMapInstanceStore((s) => s.projection);
  const theme = useUiStore((s) => s.theme);
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
    w.onmessage = (e: MessageEvent<WorkerOut>) => {
      const msg = e.data;
      if (msg.type === 'frame') {
        const f = msg as Frame;
        latestFrame.current = f;
        setFrameState(f);
        setFrame(f.at, f.selected ? { ...f.selected, at: f.at } : null);
      } else if (msg.type === 'catalogue') {
        setCatalogue(msg.version, msg.summary, msg.packed);
        const d = msg.summary;
        const base = { state: d.meta.state, fetchedAt: d.meta.fetchedAt, observedAt: d.meta.observedAt, lastGoodAt: d.meta.lastGoodAt, providers: d.providers };
        updateStatus('satellites', { ...base, count: d.total, categoryCounts: d.categoryCounts, error: undefined });
        for (const [layer, cat] of Object.entries(LAYER_CATEGORY)) updateStatus(layer as LayerId, { ...base, count: d.categoryCounts[cat as SatCategory] ?? 0, error: undefined });
        load(REFRESH_MS);
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
      w.terminate();
      workerRef.current = null;
    };
  }, [setFrame, updateStatus]);

  // CPU hit-test on the newest frame (reliable on a moving marker and where GPU picking is unavailable).
  useEffect(
    () =>
      registerHitTester('space', (point, m) =>
        hitTestSatellites(latestFrame.current, point, m, globeRef.current, (catIndex, lngLat) => {
          const s = selectionFor(catIndex, lngLat, latestFrame.current?.at ?? Date.now(), activeRef.current);
          return s ? { layer: s.layer ?? 'satellites', selection: s } : null;
        }),
      ),
    [],
  );

  // GPU pick → selection (the map's click router calls it for 'space-satellites'). The picked index
  // belongs to the frame that layer instance drew; the card opens at the satellite's position in
  // the NEWEST frame (the marker moves every tick).
  useEffect(
    () =>
      registerDeckPick(DOTS_ID, (info: DeckPickInfo): Selection | null => {
        const f = (info.layer?.props as { drawnFrame?: Frame } | undefined)?.drawnFrame;
        const i = info.index ?? -1;
        if (!f || i < 0 || i >= f.count) return null;
        const catIndex = f.index[i]!;
        const lngLat = latestLngLat(latestFrame.current, catIndex) ?? [f.positions[i * 3]!, f.positions[i * 3 + 1]!];
        return selectionFor(catIndex, lngLat, latestFrame.current?.at ?? f.at, activeRef.current);
      }),
    [],
  );

  // View (centre for the far-side filter, visible categories, palette, selection) → worker.
  useEffect(() => {
    const w = workerRef.current;
    if (!w) return;
    const post = () => {
      const c = map?.getCenter();
      w.postMessage({ type: 'view', center: projection === 'globe' && c ? [c.lng, c.lat] : null, visible, palette: palette(), selectedId });
    };
    post();
    if (!map) return;
    map.on('moveend', post);
    return () => {
      map.off('moveend', post);
    };
  }, [map, projection, visible, selectedId, theme, catalogueVersion]);

  // 1 Hz propagation clock (0.5 Hz with reduced motion); paused while the tab is hidden.
  useEffect(() => {
    const tick = () => {
      if (document.hidden) return;
      workerRef.current?.postMessage({ type: 'tick', at: Date.now() });
    };
    tick();
    const t = setInterval(tick, reduced ? TICK_MS_REDUCED : TICK_MS);
    return () => clearInterval(t);
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
      const color = readCssColor(CATEGORY_TOKEN[selData.category], 0.85);
      out.push(
        new PathLayer<{ path: [number, number, number][] }>({
          id: 'space-orbit',
          data: orbit.data.segments.map((seg) => ({ path: seg.map(([lng, lat, alt]) => [lng, lat, displayAltM(alt)] as [number, number, number]) })),
          getPath: (d) => d.path,
          getColor: color,
          getWidth: 1.5,
          widthUnits: 'pixels',
          parameters: { cullMode: 'none' },
          pickable: false,
        }),
      );
    }
    out.push(
      new SatelliteDotsLayer({
        id: DOTS_ID,
        data: {
          length: frame.count,
          attributes: {
            getPosition: { value: frame.positions, size: 3 },
            getFillColor: { value: frame.colors, size: 4, type: 'unorm8' },
            getRadius: { value: frame.radii, size: 1 },
          },
        },
        radiusUnits: 'pixels',
        radiusMinPixels: 1,
        billboard: true,
        stroked: false,
        pickable: true,
        // Read by the map's single click/hover router (src/lib/map/picking.ts), which arbitrates
        // with every other module (aircraft and cameras outrank satellites) and opens one card.
        drawnFrame: frame,
        updateTriggers: { getPosition: frame.at, getFillColor: frame.at, getRadius: frame.at },
      }),
    );
    // ISS highlight: a label beside its (enlarged) marker when it is on the visible hemisphere.
    const issIdx = indexOfId(ISS_NORAD_ID);
    const k = issIdx === undefined ? -1 : frame.index.indexOf(issIdx);
    if (k >= 0) {
      out.push(
        new TextLayer<{ p: [number, number, number] }>({
          id: 'space-iss-label',
          data: [{ p: [frame.positions[k * 3]!, frame.positions[k * 3 + 1]!, frame.positions[k * 3 + 2]!] }],
          getPosition: (d) => d.p,
          getText: () => 'ISS',
          getColor: readCssColor('--map-sat-science', 1),
          getSize: 11,
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          getPixelOffset: [0, -12],
          billboard: true,
          parameters: { cullMode: 'none' },
          pickable: false,
        }),
      );
    }
    return out;
  }, [frame, orbit.data, selData]);

  useDeckLayers('space', layers, DECK_Z);
  return null;
}
