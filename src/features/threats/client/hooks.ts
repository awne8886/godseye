'use client';
/**
 * Client plumbing shared by the threats, network and maritime layers: a polling hook that mirrors
 * the honest feed state into the layer status store (LIVE/age/STALE from meta.state, SOURCE
 * OFFLINE with last-good on 503, capability-disabled on 403), a native GeoJSON source/layer hook
 * inserted under the basemap labels, and pick registration. Layers whose registry capability
 * /api/health reports off are never requested (visual-qa round 5 m11: a 403 per poll in the
 * console); their row states the skipped provider instead. Owner: layers-threats-network.
 */
import { useQuery } from '@tanstack/react-query';
import type { LayerSpecification, Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { LAYERS, type LayerId } from '@/lib/layer-registry';
import { useLayerStatusStore, useMapInstance, type LayerStatus, type Selection } from '@/lib/layer-host';
import { registerDeckPick, registerNativePick, type DeckPickInfo, type NativeFeature } from '@/lib/map/picking';
import type { FeedMeta, HealthResponse, ProviderStatus, Providers } from '@/lib/types';

export interface Enveloped {
  meta: FeedMeta;
  providers: Providers;
}

type Result<T> = { ok: true; body: T & Enveloped } | { ok: false; status: number; body: Partial<Enveloped> & { error?: string; detail?: string } };

export function refreshMsFor(layer: LayerId): number | null {
  return LAYERS.find((l) => l.id === layer)?.refreshMs ?? null;
}

/**
 * Request options for every feed poll. Feed routes send `Cache-Control: public, s-maxage=N,
 * stale-while-revalidate=2N` for shared caches, and Chrome applies that stale-while-revalidate
 * too: each poll was answered from disk with the previous snapshot while a second, background
 * request revalidated it (two requests per poll and data one interval behind; perf r4 m-g, the
 * "second requester"). `no-cache` revalidates on every poll instead: one request, a 304 when the
 * snapshot is unchanged (ETag), never an outdated body.
 */
export const FEED_FETCH_INIT = { cache: 'no-cache', headers: { accept: 'application/json' } } as const satisfies RequestInit;

async function load<T>(url: string, signal: AbortSignal): Promise<Result<T>> {
  const res = await fetch(url, { ...FEED_FETCH_INIT, signal });
  const body = (await res.json().catch(() => ({}))) as T & Enveloped;
  if (res.status === 503 || res.status === 403) return { ok: false, status: res.status, body };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { ok: true, body };
}

/**
 * How often a layer re-fetches: a fixed interval (the registry's refreshMs), null to fetch once, or
 * a function of the last good body (null before one arrived or while the feed is offline). A
 * function also sets the query's staleTime to the same interval, so a layer toggled off and on
 * within it reuses what it has (maritime: REFERENCE-only answers refresh on an hours-long TTL).
 */
export type PollPolicy<T> = number | null | ((body: (T & Enveloped) | null) => number | null);

/** The interval a policy picks for the current query result (false = no polling). */
export function pollInterval<T>(policy: PollPolicy<T>, data: Result<T> | undefined): number | false {
  const ms = typeof policy === 'function' ? policy(data?.ok ? data.body : null) : policy;
  return ms ?? false;
}

type Capabilities = HealthResponse['capabilities'];

/** `enabled`: fetch; `disabled`: the deployment does not serve it; `unknown`: /api/health not loaded yet. */
export type CapabilityGate = 'enabled' | 'disabled' | 'unknown';

/**
 * A layer's capability gate. Keyless layers are always enabled. When /api/health failed the route
 * is asked anyway (it answers 403 capability_disabled itself), so a broken health check never
 * hides a layer the server would serve.
 */
export function capabilityGate(layer: LayerId, caps: Capabilities | undefined, healthFailed = false): CapabilityGate {
  const cap = LAYERS.find((l) => l.id === layer)?.capability ?? null;
  if (cap === null) return 'enabled';
  if (caps) return caps[cap]?.enabled === true ? 'enabled' : 'disabled';
  return healthFailed ? 'enabled' : 'unknown';
}

/**
 * Status of a layer whose capability is off: not requested, nothing drawn, the capability shown as
 * a skipped provider — "not-configured" when a key is missing (the row reads NEEDS KEY · …),
 * "licence" when a licence flag keeps it off.
 */
export function gatedStatus(layer: LayerId, caps: Capabilities | undefined): Partial<LayerStatus> {
  const cap = LAYERS.find((l) => l.id === layer)?.capability ?? 'unknown';
  const reason = caps?.[cap]?.reason ?? '';
  const skipped: ProviderStatus['skipped'] = /\bnot set\b/.test(reason) ? 'not-configured' : 'licence';
  return { state: 'idle', count: null, fetchedAt: null, observedAt: null, lastGoodAt: null, error: 'capability_disabled', providers: { [cap]: { ok: false, count: 0, ms: 0, age_s: null, skipped } } };
}

/**
 * /api/health under the HUD's query key (one shared cache entry and request), asked only for a
 * capability-gated layer: keyless layers never wait on, or add, a health request.
 */
function useHealthFor(gated: boolean) {
  return useQuery({
    queryKey: ['health'],
    queryFn: async ({ signal }) => {
      const r = await fetch('/api/health', { signal });
      if (!r.ok) throw new Error(`health HTTP ${r.status}`);
      return (await r.json()) as HealthResponse;
    },
    enabled: gated,
    retry: 1,
  });
}

/** Read the layer's capability from /api/health and report the gated status while it is not enabled. */
export function useCapabilityGate(layer: LayerId): CapabilityGate {
  const gated = (LAYERS.find((l) => l.id === layer)?.capability ?? null) !== null;
  const health = useHealthFor(gated);
  const caps = health.data?.capabilities;
  const gate = capabilityGate(layer, caps, health.isError && !health.data);
  const update = useLayerStatusStore((s) => s.update);
  useEffect(() => {
    if (gate === 'unknown') update(layer, { state: 'loading' });
    else if (gate === 'disabled') update(layer, gatedStatus(layer, caps));
  }, [gate, layer, caps, update]);
  return gate;
}

/**
 * Poll a route (registry refreshMs or a PollPolicy; react-query pauses while the tab is hidden) and
 * report status. A capability-gated layer is requested only once /api/health reports it enabled.
 */
export function useFeedData<T>(layer: LayerId, url: string | null, count: (body: T) => number | null, refreshMs: PollPolicy<T> = refreshMsFor(layer)) {
  const update = useLayerStatusStore((s) => s.update);
  const gate = useCapabilityGate(layer);
  const enabled = url !== null && gate === 'enabled';
  const q = useQuery({
    queryKey: ['threats-network', url],
    queryFn: ({ signal }) => load<T>(url!, signal),
    enabled,
    refetchInterval: (query) => pollInterval(refreshMs, query.state.data),
    ...(typeof refreshMs === 'function' ? { staleTime: (query: { state: { data: Result<T> | undefined } }) => pollInterval(refreshMs, query.state.data) || 0 } : {}),
    refetchIntervalInBackground: false,
    placeholderData: (prev) => prev,
  });
  const result = enabled ? q.data : undefined;
  const failed = q.isError;
  const loading = q.isPending && enabled;
  useEffect(() => {
    if (!enabled) return; // useCapabilityGate reports a gated layer
    if (loading) return update(layer, { state: 'loading' });
    if (failed && !result) return update(layer, { state: 'offline', count: null, error: 'unreachable' });
    if (!result) return;
    if (!result.ok) {
      const { meta, providers } = result.body;
      return update(layer, {
        state: 'offline',
        count: null,
        fetchedAt: meta?.fetchedAt ?? null,
        observedAt: meta?.observedAt ?? null,
        lastGoodAt: meta?.lastGoodAt ?? null,
        error: result.status === 403 ? 'capability_disabled' : 'source_offline',
        providers,
        attribution: meta?.attribution,
      });
    }
    const { meta, providers } = result.body;
    update(layer, { state: meta.state, count: count(result.body), fetchedAt: meta.fetchedAt, observedAt: meta.observedAt, lastGoodAt: meta.lastGoodAt, error: undefined, providers, attribution: meta.attribution });
  }, [layer, enabled, result, failed, loading, update, count]);
  useEffect(() => () => update(layer, { state: 'idle', count: null }), [layer, update]);
  return result?.ok ? result.body : null;
}

type Spec = Exclude<LayerSpecification, { type: 'background' | 'raster' | 'hillshade' | 'color-relief' }>;

function firstSymbolId(map: MapLibreMap): string | undefined {
  return map.getStyle()?.layers?.find((l) => l.type === 'symbol')?.id;
}

/** A native GeoJSON source + style layers under the labels; re-added after a style reload. */
export function useNativeLayers(sourceId: string, data: GeoJSON.FeatureCollection | null, layers: Omit<Spec, 'source'>[]): void {
  const map = useMapInstance();
  const dataRef = useRef(data);
  const layersRef = useRef(layers);
  useEffect(() => {
    dataRef.current = data;
    layersRef.current = layers;
  });
  useEffect(() => {
    if (!map) return;
    const ensure = () => {
      try {
        if (!map.getStyle()) return;
        if (!map.getSource(sourceId)) map.addSource(sourceId, { type: 'geojson', data: dataRef.current ?? { type: 'FeatureCollection', features: [] } });
        const before = firstSymbolId(map);
        for (const l of layersRef.current) if (!map.getLayer(l.id)) map.addLayer({ ...l, source: sourceId } as LayerSpecification, before);
      } catch {
        // The style is mid-(re)load: retried on the next styledata/idle event.
      }
    };
    ensure();
    const enter = () => (map.getCanvas().style.cursor = 'pointer');
    const leave = () => (map.getCanvas().style.cursor = '');
    const ids = layersRef.current.map((l) => l.id);
    for (const id of ids) {
      map.on('mouseenter', id, enter);
      map.on('mouseleave', id, leave);
    }
    map.on('styledata', ensure);
    map.on('idle', ensure);
    return () => {
      map.off('styledata', ensure);
      map.off('idle', ensure);
      for (const id of ids) {
        map.off('mouseenter', id, enter);
        map.off('mouseleave', id, leave);
      }
      try {
        if (!map.getStyle()) return;
        for (const id of ids) if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      } catch {
        // The map is being torn down.
      }
    };
  }, [map, sourceId]);
  useEffect(() => {
    if (!map || !data) return;
    (map.getSource(sourceId) as { setData?: (d: GeoJSON.FeatureCollection) => void } | undefined)?.setData?.(data);
  }, [map, sourceId, data]);
  useEffect(() => {
    if (!map) return;
    for (const l of layers) {
      if (!map.getLayer(l.id) || !('paint' in l) || !l.paint) continue;
      for (const [k, v] of Object.entries(l.paint)) map.setPaintProperty(l.id, k as Parameters<MapLibreMap['setPaintProperty']>[1], v);
    }
  }, [map, layers]);
}

/** Register native pick resolvers for style layers; `lookup` maps a feature's `id` to a Selection. */
export function useNativePick(styleLayerIds: readonly string[], lookup: (id: string, f: NativeFeature) => Selection | null): void {
  const ref = useRef(lookup);
  useEffect(() => {
    ref.current = lookup;
  });
  const key = styleLayerIds.join('|');
  useEffect(() => {
    const offs = key.split('|').map((id) =>
      registerNativePick(id, (f) => {
        const pid = f.properties?.id;
        return typeof pid === 'string' || typeof pid === 'number' ? ref.current(String(pid), f) : null;
      }),
    );
    return () => offs.forEach((off) => off());
  }, [key]);
}

/** Register a deck pick resolver for a deck layer id. */
export function useDeckPick(deckLayerId: string, resolve: (info: DeckPickInfo) => Selection | null): void {
  const ref = useRef(resolve);
  useEffect(() => {
    ref.current = resolve;
  });
  useEffect(() => registerDeckPick(deckLayerId, (info) => ref.current(info)), [deckLayerId]);
}

export const rgbaCss = ([r, g, b, a]: readonly number[]) => `rgba(${r},${g},${b},${((a ?? 255) / 255).toFixed(3)})`;

export function pointsFc<T extends { id: string; lat: number; lng: number }>(items: readonly T[], props: (t: T) => Record<string, string | number | boolean | null>): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: items.map((t) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [t.lng, t.lat] }, properties: { id: t.id, ...props(t) } })),
  };
}
