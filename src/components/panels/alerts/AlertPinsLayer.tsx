'use client';
/**
 * `alert_pins` layer: geoparsed Live Alerts as native MapLibre circles coloured by kind (keyword
 * rule), sized by precision (country-level pins are drawn hollow and larger — they are not event
 * locations). Clicks route through registerNativePick; alerts are published to the Intel Feed and
 * the layer status (count, freshness, providers) to the rail. With the timeline scrubber set, only
 * alerts published at or before the cursor are pinned (hud/timeline.ts); pins new since the previous
 * poll ring outward once (hud/arrival-rings.ts). Owner: panels-alerts-markets-dossier-graph.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';
import { useArrivalRings } from '@/components/hud/arrival-rings';
import { filterAtCursor, heldSpan, oldestMs, timeMs, useReportCoverage, useTimeCursor } from '@/components/hud/timeline';
import { LAYERS } from '@/lib/layer-registry';
import { useGeoJsonLayers } from '@/lib/map/use-geojson-layers';
import type { LayerComponentProps } from '@/lib/feature-module';
import { useDeckLayers, useFeedEventStore, useLayerStatusStore, type LayerStatus } from '@/lib/layer-host';
import { registerNativePick } from '@/lib/map/picking';
import { readCssColor, type MapToken } from '@/lib/tokens';
import type { AlertItem, FeedEvent, NewsResponse } from '@/lib/types';
import { FeedOfflineError, NEWS_QUERY_KEY, fetchNews } from '../intel/client';
import { queryFailure } from '../intel/query-state';

export const ALERT_SOURCE = 'godseye-alert-pins';
export const ALERT_CIRCLE = 'godseye-alert-pins-circle';

const css = (t: MapToken, a = 1) => {
  const [r, g, b, al] = readCssColor(t, a);
  return `rgba(${r},${g},${b},${(al / 255).toFixed(3)})`;
};

const Z = LAYERS.find((l) => l.id === 'alert_pins')!.z;
const alertObservedMs = (it: AlertItem) => timeMs(it.publishedAt);
const alertId = (it: AlertItem) => it.id;
const alertPosition = (it: AlertItem): [number, number] => [it.place!.lng, it.place!.lat];
const alertRadiusPx = (it: AlertItem) => (it.place!.precision === 'country' ? 9 : it.place!.precision === 'region' ? 7 : 5);

export function severityOf(it: AlertItem): FeedEvent['severity'] {
  if (it.risk.score >= 8) return 'high';
  if (it.kind === 'rocket' || it.risk.score >= 5) return 'medium';
  return it.risk.score >= 3 ? 'low' : 'info';
}

export function toFeedEvent(it: AlertItem): FeedEvent {
  return {
    id: it.id,
    layer: 'alert_pins',
    entityKind: 'alert',
    entityId: it.id,
    title: it.title.slice(0, 160),
    detail: `${it.sourceName} (${it.lean})${it.place ? ` · ${it.place.name}, ${it.place.precision}` : ''}`,
    severity: severityOf(it),
    observedAt: it.publishedAt,
    ...(it.place ? { lat: it.place.lat, lng: it.place.lng } : {}),
    source: it.source,
  };
}

export function toFeatures(items: readonly AlertItem[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: items
      .filter((it) => it.place)
      .map((it) => ({
        type: 'Feature',
        id: it.id,
        geometry: { type: 'Point', coordinates: [it.place!.lng, it.place!.lat] },
        properties: { id: it.id, kind: it.kind, precision: it.place!.precision, title: it.title },
      })),
  };
}

/**
 * The rail status for the news query. An error wins even while react-query still holds the last
 * copy (the pins stay drawn from it, and the rail says SOURCE OFFLINE with that copy's fetch time,
 * matching the ALERTS panel chip); once a refetch succeeds the error and its code are cleared, even
 * when structural sharing hands back the very same `data` object.
 */
export function alertPinsStatus(q: { data: NewsResponse | undefined; error: unknown; isPending: boolean }): Partial<LayerStatus> | null {
  const failure = queryFailure(q, (d) => d.meta.fetchedAt);
  if (failure) {
    const providers = q.error instanceof FeedOfflineError ? q.error.providers : null;
    const error = failure.status === null ? 'unreachable' : failure.status === 503 ? 'Source offline' : `http_${failure.status}`;
    return { state: 'offline', error, lastGoodAt: failure.lastGoodAt, ...(providers ? { providers } : {}) };
  }
  if (q.data) {
    const { meta } = q.data;
    return { state: meta.state, error: undefined, count: q.data.items.filter((it) => it.place).length, fetchedAt: meta.fetchedAt, observedAt: meta.observedAt, lastGoodAt: meta.lastGoodAt, providers: q.data.providers, attribution: meta.attribution };
  }
  return q.isPending ? { state: 'loading' } : null;
}

export default function AlertPinsLayer(_: LayerComponentProps) {
  const q = useQuery({ queryKey: NEWS_QUERY_KEY, queryFn: ({ signal }) => fetchNews({ signal }), refetchInterval: 120_000, refetchIntervalInBackground: false, staleTime: 60_000 });
  const update = useLayerStatusStore((s) => s.update);
  const push = useFeedEventStore((s) => s.push);
  const byId = useRef(new Map<string, AlertItem>());

  const cursor = useTimeCursor();
  // Timeline replay: only alerts published at or before the cursor (the same array when live).
  const shown = useMemo(() => (q.data ? filterAtCursor(q.data.items, cursor, alertObservedMs) : null), [q.data, cursor]);
  const data = useMemo(() => (shown ? toFeatures(shown) : null), [shown]);
  const placed = useMemo(() => q.data?.items.filter((it) => it.place) ?? null, [q.data]);
  // The wire/Telegram feed declares no window: it holds from its oldest item to the fetch.
  const span = q.data ? heldSpan(q.data.meta.fetchedAt, null, oldestMs(q.data.items, alertObservedMs)) : null;
  useReportCoverage('alert_pins', span && placed ? { ...span, shown: data?.features.length ?? 0, total: placed.length } : null);
  const rings = useArrivalRings({ id: 'alert-pins-arrivals', items: placed, idOf: alertId, positionOf: alertPosition, observedMs: alertObservedMs, radiusPx: alertRadiusPx, color: readCssColor('--map-alert-event', 0.9) });
  const deck = useMemo(() => (rings ? [rings] : null), [rings]);
  useDeckLayers('alerts:arrivals', deck, Z);
  const layers = useMemo(
    () => [
      {
        id: ALERT_CIRCLE,
        type: 'circle' as const,
        paint: {
          'circle-radius': ['match', ['get', 'precision'], 'country', 9, 'region', 7, 5] as unknown as number,
          'circle-color': ['match', ['get', 'kind'], 'rocket', css('--map-alert-rocket', 0.85), 'event', css('--map-alert-event', 0.85), css('--map-alert-news', 0.85)] as unknown as string,
          'circle-opacity': ['match', ['get', 'precision'], 'country', 0.15, 0.9] as unknown as number,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': ['match', ['get', 'kind'], 'rocket', css('--map-alert-rocket'), 'event', css('--map-alert-event'), css('--map-alert-news')] as unknown as string,
        },
      },
    ],
    [],
  );
  useGeoJsonLayers(ALERT_SOURCE, data, layers);

  useEffect(() => {
    if (!q.data) return;
    byId.current = new Map(q.data.items.map((it) => [it.id, it]));
    push(q.data.items.map(toFeedEvent));
  }, [q.data, push]);

  const { data: qData, error: qError, isPending } = q;
  useEffect(() => {
    const patch = alertPinsStatus({ data: qData, error: qError, isPending });
    if (patch) update('alert_pins', patch);
  }, [qData, qError, isPending, update]);

  useEffect(
    () =>
      registerNativePick(ALERT_CIRCLE, (f) => {
        const id = f.properties?.id;
        const it = typeof id === 'string' ? byId.current.get(id) : undefined;
        if (!it || !it.place) return null;
        return { kind: 'alert', id: it.id, layer: 'alert_pins', source: it.source, observedAt: it.publishedAt, data: it as unknown as Record<string, unknown>, lngLat: [it.place.lng, it.place.lat] };
      }),
    [],
  );
  return null;
}
