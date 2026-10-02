'use client';
/**
 * `alert_pins` layer: geoparsed Live Alerts as native MapLibre circles coloured by kind (keyword
 * rule), sized by precision (country-level pins are drawn hollow and larger — they are not event
 * locations). Clicks route through registerNativePick; alerts are published to the Intel Feed and
 * the layer status (count, freshness, providers) to the rail. Owner: panels-alerts-markets-dossier-graph.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';
import { useGeoJsonLayers } from '@/lib/map/use-geojson-layers';
import type { LayerComponentProps } from '@/lib/feature-module';
import { useFeedEventStore, useLayerStatusStore } from '@/lib/layer-host';
import { registerNativePick } from '@/lib/map/picking';
import { readCssColor, type MapToken } from '@/lib/tokens';
import type { AlertItem, FeedEvent } from '@/lib/types';
import { FeedOfflineError, NEWS_QUERY_KEY, fetchNews } from '../intel/client';

export const ALERT_SOURCE = 'godseye-alert-pins';
export const ALERT_CIRCLE = 'godseye-alert-pins-circle';

const css = (t: MapToken, a = 1) => {
  const [r, g, b, al] = readCssColor(t, a);
  return `rgba(${r},${g},${b},${(al / 255).toFixed(3)})`;
};

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

export default function AlertPinsLayer(_: LayerComponentProps) {
  const q = useQuery({ queryKey: NEWS_QUERY_KEY, queryFn: ({ signal }) => fetchNews({ signal }), refetchInterval: 120_000, refetchIntervalInBackground: false, staleTime: 60_000 });
  const update = useLayerStatusStore((s) => s.update);
  const push = useFeedEventStore((s) => s.push);
  const byId = useRef(new Map<string, AlertItem>());

  const data = useMemo(() => (q.data ? toFeatures(q.data.items) : null), [q.data]);
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
    update('alert_pins', {
      state: q.data.meta.state,
      count: q.data.items.filter((it) => it.place).length,
      fetchedAt: q.data.meta.fetchedAt,
      observedAt: q.data.meta.observedAt,
      lastGoodAt: q.data.meta.lastGoodAt,
      providers: q.data.providers,
      attribution: q.data.meta.attribution,
    });
  }, [q.data, push, update]);

  useEffect(() => {
    if (!q.error) return;
    const e = q.error instanceof FeedOfflineError ? q.error : null;
    update('alert_pins', { state: 'offline', error: 'Source offline', lastGoodAt: e?.meta?.lastGoodAt ?? null, ...(e?.providers ? { providers: e.providers } : {}) });
  }, [q.error, update]);

  useEffect(() => {
    if (q.isPending) update('alert_pins', { state: 'loading' });
  }, [q.isPending, update]);

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
