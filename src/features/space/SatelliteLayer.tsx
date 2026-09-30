'use client';
/**
 * Satellites on the globe: fetches the OMM catalogue, hands it to the propagation worker, and
 * publishes deck.gl layers from the worker's typed arrays (binary attributes, no per-frame React
 * state beyond the layer list). Mission colours come from `--map-sat-*` tokens; satellites in
 * Earth's shadow are dimmed; the ISS and the selected satellite are enlarged; the selected
 * satellite's orbit (±½ period) is drawn at the same compressed altitude as the markers.
 * Owner: layers-space.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { LayersList, PickingInfo } from '@deck.gl/core';
import type { LayerComponentProps } from '@/lib/feature-module';
import { useDeckLayers, useLayerStatusStore, useMapInstance, useMapInstanceStore, useSelectionStore } from '@/lib/layer-host';
import { useUiStore } from '@/lib/store';
import { readCssColor } from '@/lib/tokens';
import type { LayerId } from '@/lib/layer-registry';
import { CATEGORY_TOKEN, LAYER_CATEGORY, SAT_CATEGORIES } from './lib/catalog';
import { ISS_NORAD_ID, displayAltM } from './lib/propagate-batch';
import {
  FeedOfflineError,
  SATELLITES_QUERY_KEY,
  catalogue,
  fetchOrbit,
  fetchSatellites,
  orbitQueryKey,
  recordAt,
  selectionDataFor,
  setCatalogue,
  useSpaceStore,
  type SatelliteSelectionData,
} from './client/data';
import type { SatCategory } from '@/lib/types';

const REFRESH_MS = 120 * 60_000;
const TICK_MS = 1000;
const TICK_MS_REDUCED = 2000;
const DECK_Z = 90;
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
  const query = useQuery({ queryKey: SATELLITES_QUERY_KEY, queryFn: fetchSatellites, refetchInterval: REFRESH_MS, staleTime: 5 * 60_000 });
  const map = useMapInstance();
  const projection = useMapInstanceStore((s) => s.projection);
  const theme = useUiStore((s) => s.theme);
  const selection = useSelectionStore((s) => s.selection);
  const select = useSelectionStore((s) => s.select);
  const updateStatus = useLayerStatusStore((s) => s.update);
  const setFrame = useSpaceStore((s) => s.setFrame);
  const reduced = useReducedMotion();
  const workerRef = useRef<Worker | null>(null);
  const [frame, setFrameState] = useState<Frame | null>(null);
  const selectedId = selection?.kind === 'satellite' ? Number(selection.id) : null;
  const visible = useMemo(() => visibleCategories(active), [active]);

  // Worker lifecycle.
  useEffect(() => {
    const w = new Worker(new URL('../../workers/tle-propagate.ts', import.meta.url), { type: 'module', name: 'tle-propagate' });
    workerRef.current = w;
    w.onmessage = (e: MessageEvent<{ type: string } & Partial<Frame>>) => {
      if (e.data.type !== 'frame') return;
      const f = e.data as Frame;
      setFrameState(f);
      setFrame(f.at, f.selected ? { ...f.selected, at: f.at } : null);
    };
    return () => {
      w.terminate();
      workerRef.current = null;
    };
  }, [setFrame]);

  // Catalogue → worker; status → rail badges.
  useEffect(() => {
    const d = query.data;
    if (d) {
      setCatalogue(d);
      workerRef.current?.postMessage({ type: 'catalogue', version: `${d.meta.fetchedAt}`, rows: d.rows });
      const base = { state: d.meta.state, fetchedAt: d.meta.fetchedAt, observedAt: d.meta.observedAt, lastGoodAt: d.meta.lastGoodAt, providers: d.providers };
      updateStatus('satellites', { ...base, count: d.rows.length, categoryCounts: d.categoryCounts, error: undefined });
      for (const [layer, cat] of Object.entries(LAYER_CATEGORY)) updateStatus(layer as LayerId, { ...base, count: d.categoryCounts[cat as SatCategory] ?? 0, error: undefined });
    } else if (query.error) {
      const meta = query.error instanceof FeedOfflineError ? query.error.meta : null;
      const patch = { state: 'offline' as const, count: null, fetchedAt: meta?.fetchedAt ?? null, observedAt: meta?.observedAt ?? null, lastGoodAt: meta?.lastGoodAt ?? null, error: 'SOURCE OFFLINE' };
      updateStatus('satellites', patch);
      for (const layer of Object.keys(LAYER_CATEGORY)) updateStatus(layer as LayerId, patch);
    } else if (query.isPending) {
      updateStatus('satellites', { state: 'loading' });
    }
  }, [query.data, query.error, query.isPending, updateStatus]);

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
  }, [map, projection, visible, selectedId, theme, query.data]);

  // 1 Hz propagation clock (0.5 Hz with reduced motion); paused while the tab is hidden.
  useEffect(() => {
    const tick = () => {
      if (document.hidden) return;
      workerRef.current?.postMessage({ type: 'tick', at: Date.now() });
    };
    tick();
    const t = setInterval(tick, reduced ? TICK_MS_REDUCED : TICK_MS);
    return () => clearInterval(t);
  }, [reduced, query.data]);

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
      new ScatterplotLayer({
        id: 'space-satellites',
        data: {
          length: frame.count,
          attributes: {
            getPosition: { value: frame.positions, size: 3 },
            getFillColor: { value: frame.colors, size: 4 },
            getRadius: { value: frame.radii, size: 1 },
          },
        },
        radiusUnits: 'pixels',
        radiusMinPixels: 1,
        billboard: true,
        stroked: false,
        pickable: true,
        onClick: (info: PickingInfo) => {
          const f = frame;
          if (info.index < 0 || info.index >= f.count) return false;
          const rec = recordAt(f.index[info.index]!);
          if (!rec) return false;
          const lng = f.positions[info.index * 3]!;
          const lat = f.positions[info.index * 3 + 1]!;
          const layer: LayerId = active.has('satellites') ? 'satellites' : ((Object.entries(LAYER_CATEGORY).find(([, c]) => c === rec.category)?.[0] as LayerId | undefined) ?? 'satellites');
          select({
            kind: 'satellite',
            id: String(rec.noradId),
            layer,
            source: catalogue()?.source === 'satnogs-fallback' ? 'satnogs' : 'celestrak',
            observedAt: rec.epoch,
            data: selectionDataFor(rec, f.at),
            lngLat: [lng, lat],
          });
          return true;
        },
        updateTriggers: { getPosition: frame.at, getFillColor: frame.at, getRadius: frame.at },
      }),
    );
    // ISS highlight: a label beside its (enlarged) marker when it is on the visible hemisphere.
    const issIdx = catalogue()?.byId.get(ISS_NORAD_ID);
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
  }, [frame, orbit.data, selData, active, select]);

  useDeckLayers('space', layers, DECK_Z);
  return null;
}
