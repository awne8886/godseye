'use client';
/**
 * Threats & intel layers: nuclear facilities, GDACS global incidents, GDELT events, conflict zones
 * (+ in-zone events at their own coordinates), DeepState frontlines and the country-risk
 * choropleth. Each sub-layer fetches, renders and reports its own status and unmounts cleanly.
 * Owner: layers-threats-network.
 */
import { ScatterplotLayer } from '@deck.gl/layers';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import type { LayerComponentProps } from '@/lib/feature-module';
import { LAYERS } from '@/lib/layer-registry';
import { useDeckLayers, useFeedEventStore, type Selection } from '@/lib/layer-host';
import { readCssColor } from '@/lib/tokens';
import type { ConflictEvent, ConflictsResponse, CountryRiskResponse, FeedEvent, FrontlinesResponse, GdacsIncident, GdacsResponse, GdeltEvent, GdeltEventsResponse, InfrastructureResponse, NuclearSite } from '@/lib/types';
import { gdeltTitle, QUAD_TOKEN } from '../shared/gdelt';
import { rgbaCss, useDeckPick, useFeedData, useNativeLayers, useNativePick } from './hooks';

const zOf = (id: string) => LAYERS.find((l) => l.id === id)!.z;
const css = (token: Parameters<typeof readCssColor>[0], alpha = 1) => rgbaCss(readCssColor(token, alpha));

// ── Nuclear facilities ───────────────────────────────────────────────────────────
function nuclearClass(s: NuclearSite): string {
  if (s.flags.some((f) => f.kind === 'conflict')) return 'conflict';
  if (s.flags.some((f) => f.kind === 'seismic')) return 'seismic';
  if (s.status === 'decommissioned' || s.status === 'shutdown') return 'decommissioned';
  if (s.status === 'under_construction' || s.status === 'planned') return 'construction';
  return 'nuclear';
}

const NUCLEAR_TOKEN: Record<string, Parameters<typeof readCssColor>[0]> = {
  conflict: '--map-nuclear-conflict',
  seismic: '--map-nuclear-seismic',
  decommissioned: '--map-nuclear-decommissioned',
  construction: '--map-nuclear-construction',
  nuclear: '--map-nuclear',
};

function NuclearLayer() {
  const data = useFeedData<InfrastructureResponse>('infrastructure', '/api/infrastructure', (b) => b.items.length);
  const items = data?.items;
  const layers = useMemo(
    () =>
      items
        ? [
            new ScatterplotLayer<NuclearSite>({
              id: 'tn-nuclear',
              data: items,
              getPosition: (s) => [s.lng, s.lat],
              getRadius: (s) => (s.flags.length ? 6 : 4.5),
              radiusUnits: 'pixels',
              getFillColor: (s) => readCssColor(NUCLEAR_TOKEN[nuclearClass(s)]!, 0.9),
              getLineColor: readCssColor('--map-nuclear', 1),
              stroked: true,
              lineWidthUnits: 'pixels',
              getLineWidth: 1,
              pickable: true,
              autoHighlight: true,
            }),
          ]
        : null,
    [items],
  );
  useDeckLayers('threats:nuclear', layers, zOf('infrastructure'));
  useDeckPick('tn-nuclear', (info) => {
    const s = info.object as NuclearSite | undefined;
    return s ? { kind: 'nuclear_site', id: s.id, layer: 'infrastructure', source: s.source, observedAt: null, data: s as unknown as Record<string, unknown>, lngLat: [s.lng, s.lat] } : null;
  });
  return null;
}

// ── GDACS global incidents ───────────────────────────────────────────────────────
export function gdacsEvents(items: readonly GdacsIncident[]): FeedEvent[] {
  return items
    .filter((i) => (i.alertLevel === 'orange' || i.alertLevel === 'red') && i.observedAt)
    .map((i) => ({
      id: `${i.id}:${i.observedAt}`,
      layer: 'global_incidents',
      entityKind: 'gdacs_incident' as const,
      entityId: i.id,
      title: i.title,
      detail: i.country ?? undefined,
      severity: i.alertLevel === 'red' ? ('high' as const) : ('medium' as const),
      observedAt: i.observedAt!,
      lat: i.lat,
      lng: i.lng,
      source: 'GDACS',
    }));
}

function GdacsLayer() {
  const data = useFeedData<GdacsResponse>('global_incidents', '/api/gdacs', (b) => b.items.length);
  const items = data?.items;
  const push = useFeedEventStore((s) => s.push);
  useEffect(() => {
    if (items) push(gdacsEvents(items));
  }, [items, push]);
  const layers = useMemo(
    () =>
      items
        ? [
            new ScatterplotLayer<GdacsIncident>({
              id: 'tn-gdacs',
              data: items,
              getPosition: (i) => [i.lng, i.lat],
              getRadius: (i) => (i.alertLevel === 'red' ? 8 : i.alertLevel === 'orange' ? 6 : 4),
              radiusUnits: 'pixels',
              getFillColor: (i) => readCssColor(i.alertLevel === 'red' ? '--map-incident' : i.alertLevel === 'orange' ? '--map-seismic' : '--map-seismic-low', 0.85),
              getLineColor: readCssColor('--map-incident', 0.9),
              stroked: true,
              lineWidthUnits: 'pixels',
              getLineWidth: 1,
              pickable: true,
              autoHighlight: true,
            }),
          ]
        : null,
    [items],
  );
  useDeckLayers('threats:gdacs', layers, zOf('global_incidents'));
  useDeckPick('tn-gdacs', (info) => {
    const s = info.object as GdacsIncident | undefined;
    return s ? { kind: 'gdacs_incident', id: s.id, layer: 'global_incidents', source: 'gdacs', observedAt: s.observedAt, data: s as unknown as Record<string, unknown>, lngLat: [s.lng, s.lat] } : null;
  });
  return null;
}

// ── GDELT events (deck) ──────────────────────────────────────────────────────────
export function gdeltEvents(items: readonly GdeltEvent[]): FeedEvent[] {
  return items
    .filter((e) => e.quadClass === 4 && e.numSources >= 3 && e.geoPrecision >= 3)
    .sort((a, b) => b.numMentions - a.numMentions)
    .slice(0, 25)
    .map((e) => ({ id: e.id, layer: 'gdelt_events', entityKind: 'gdelt_event' as const, entityId: e.id, title: gdeltTitle(e), detail: e.place ?? undefined, severity: 'medium' as const, observedAt: e.dateAdded, lat: e.lat, lng: e.lng, source: 'GDELT' }));
}

const gdeltRadius = (e: GdeltEvent) => Math.min(9, 2.5 + Math.log2(1 + e.numMentions));

function GdeltLayer() {
  const data = useFeedData<GdeltEventsResponse>('gdelt_events', '/api/gdelt-events?limit=2000', (b) => b.items.length);
  const items = data?.items;
  const push = useFeedEventStore((s) => s.push);
  useEffect(() => {
    if (items) push(gdeltEvents(items));
  }, [items, push]);
  const layers = useMemo(() => {
    if (!items) return null;
    return [
      new ScatterplotLayer<GdeltEvent>({
        id: 'tn-gdelt',
        data: [...items].sort((a, b) => a.quadClass - b.quadClass),
        getPosition: (e) => [e.lng, e.lat],
        getRadius: gdeltRadius,
        radiusUnits: 'pixels',
        getFillColor: (e) => readCssColor(QUAD_TOKEN[e.quadClass], 0.7),
        getLineColor: (e) => readCssColor(QUAD_TOKEN[e.quadClass], 1),
        stroked: true,
        lineWidthUnits: 'pixels',
        getLineWidth: 0.5,
        pickable: true,
        autoHighlight: true,
      }),
    ];
  }, [items]);
  useDeckLayers('threats:gdelt', layers, zOf('gdelt_events'));
  useDeckPick('tn-gdelt', (info) => {
    const e = info.object as GdeltEvent | undefined;
    return e ? { kind: 'gdelt_event', id: e.id, layer: 'gdelt_events', source: 'gdelt', observedAt: e.dateAdded, data: e as unknown as Record<string, unknown>, lngLat: [e.lng, e.lat] } : null;
  });
  return null;
}

// ── Conflict zones (REFERENCE) + events at their own coordinates ────────────────
const SEVERITY_ALPHA: Record<string, number> = { war: 0.22, high: 0.15, elevated: 0.09 };

function ConflictLayer() {
  const data = useFeedData<ConflictsResponse>('conflict_zones', '/api/conflicts', (b) => b.zones.length);
  const zones = data?.zones;
  const events = data?.events;
  const zoneFc = useMemo<GeoJSON.FeatureCollection | null>(
    () =>
      zones
        ? { type: 'FeatureCollection', features: zones.map((z) => ({ type: 'Feature', geometry: z.polygon, properties: { id: z.id, severity: z.severity, label: z.label } })) }
        : null,
    [zones],
  );
  const zoneLayers = useMemo(
    () => [
      {
        id: 'tn-zones-fill',
        type: 'fill' as const,
        paint: { 'fill-color': css('--map-conflict'), 'fill-opacity': ['match', ['get', 'severity'], 'war', SEVERITY_ALPHA.war!, 'high', SEVERITY_ALPHA.high!, SEVERITY_ALPHA.elevated!] as unknown as number },
      },
      { id: 'tn-zones-line', type: 'line' as const, paint: { 'line-color': css('--map-conflict', 0.8), 'line-width': 1, 'line-dasharray': [3, 2] } },
    ],
    [],
  );
  useNativeLayers('tn-zones', zoneFc, zoneLayers);
  const zById = useMemo(() => new Map((zones ?? []).map((z) => [z.id, z])), [zones]);
  const eventLayers = useMemo(
    () =>
      events
        ? [
            new ScatterplotLayer<ConflictEvent>({
              id: 'tn-zone-events',
              data: events,
              getPosition: (e) => [e.lng, e.lat],
              getRadius: 3.5,
              radiusUnits: 'pixels',
              getFillColor: readCssColor('--map-gdelt-4', 0.85),
              getLineColor: readCssColor('--map-conflict', 1),
              stroked: true,
              lineWidthUnits: 'pixels',
              getLineWidth: 0.75,
              pickable: true,
            }),
          ]
        : null,
    [events],
  );
  useDeckLayers('threats:zone-events', eventLayers, zOf('conflict_zones'));
  useNativePick(['tn-zones-fill'], (id) => {
    const z = zById.get(id);
    return z ? { kind: 'conflict_zone', id: z.id, layer: 'conflict_zones', source: 'curated', observedAt: null, data: z as unknown as Record<string, unknown>, lngLat: z.anchor } : null;
  });
  useDeckPick('tn-zone-events', (info) => {
    const e = info.object as ConflictEvent | undefined;
    return e ? ({ kind: 'conflict_zone', id: e.id, layer: 'conflict_zones', source: 'gdelt', observedAt: e.observedAt, data: e as unknown as Record<string, unknown>, lngLat: [e.lng, e.lat] } satisfies Selection) : null;
  });
  return null;
}

// ── Frontlines ──────────────────────────────────────────────────────────────────
function FrontlinesLayer() {
  const data = useFeedData<FrontlinesResponse>('frontlines', '/api/frontlines', (b) => b.geojson.features.length);
  const fc = data?.geojson ?? null;
  const asOf = data?.asOf ?? null;
  const layers = useMemo(
    () => [
      { id: 'tn-front-fill', type: 'fill' as const, filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]] as unknown as boolean, paint: { 'fill-color': css('--map-conflict'), 'fill-opacity': 0.25 } },
      { id: 'tn-front-line', type: 'line' as const, paint: { 'line-color': css('--map-conflict'), 'line-width': 1.5 } },
    ],
    [],
  );
  useNativeLayers('tn-front', fc, layers);
  useNativePick(['tn-front-fill'], (id, f) => ({
    kind: 'frontline',
    id,
    layer: 'frontlines',
    source: 'deepstate',
    observedAt: asOf,
    data: { name: typeof f.properties?.name === 'string' ? f.properties.name : null, asOf },
    lngLat: null,
  }));
  return null;
}

// ── Country risk choropleth (REFERENCE) ─────────────────────────────────────────
function CountryRiskLayer() {
  const data = useFeedData<CountryRiskResponse>('country_risk', '/api/country-risk', (b) => b.items.length);
  const shapes = useQuery({
    queryKey: ['zones-countries'],
    queryFn: async () => (await (await fetch('/data/zones-countries.json')).json()) as GeoJSON.FeatureCollection,
    staleTime: Infinity,
  }).data;
  const items = data?.items;
  const byIso = useMemo(() => new Map((items ?? []).map((r) => [r.iso3, r])), [items]);
  const fc = useMemo<GeoJSON.FeatureCollection | null>(() => {
    if (!shapes || !items) return null;
    return {
      type: 'FeatureCollection',
      features: shapes.features.flatMap((f) => {
        const iso3 = String(f.properties?.iso3 ?? '');
        const r = byIso.get(iso3);
        return r && r.score !== null ? [{ ...f, properties: { id: iso3, score: r.score } }] : [];
      }),
    };
  }, [shapes, items, byIso]);
  const layers = useMemo(
    () => [
      {
        id: 'tn-risk-fill',
        type: 'fill' as const,
        paint: { 'fill-color': css('--map-risk'), 'fill-opacity': ['interpolate', ['linear'], ['get', 'score'], 0, 0.02, 3.5, 0.12, 5, 0.25, 6.5, 0.42, 9, 0.6] as unknown as number },
      },
      { id: 'tn-risk-line', type: 'line' as const, paint: { 'line-color': css('--map-risk', 0.35), 'line-width': 0.5 } },
    ],
    [],
  );
  useNativeLayers('tn-risk', fc, layers);
  useNativePick(['tn-risk-fill'], (id) => {
    const r = byIso.get(id);
    return r ? { kind: 'country_risk', id: r.iso3, layer: 'country_risk', source: 'inform', observedAt: null, data: r as unknown as Record<string, unknown>, lngLat: null } : null;
  });
  return null;
}

export default function ThreatsLayer({ active }: LayerComponentProps) {
  return (
    <>
      {active.has('country_risk') && <CountryRiskLayer />}
      {active.has('conflict_zones') && <ConflictLayer />}
      {active.has('frontlines') && <FrontlinesLayer />}
      {active.has('infrastructure') && <NuclearLayer />}
      {active.has('global_incidents') && <GdacsLayer />}
      {active.has('gdelt_events') && <GdeltLayer />}
    </>
  );
}
