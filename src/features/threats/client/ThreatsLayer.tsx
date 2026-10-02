'use client';
/**
 * Threats & intel layers: nuclear facilities, GDACS global incidents, GDELT events, conflict zones
 * (+ in-zone events at their own coordinates), DeepState frontlines and the country-risk
 * choropleth. Each sub-layer fetches, renders and reports its own status and unmounts cleanly.
 * Point layers draw over the globe surface and only on the camera-facing hemisphere (./globe.ts).
 * Owner: layers-threats-network.
 */
import { ScatterplotLayer } from '@deck.gl/layers';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';
import type { LayerComponentProps } from '@/lib/feature-module';
import { LAYERS } from '@/lib/layer-registry';
import { useDeckLayers, useFeedEventStore } from '@/lib/layer-host';
import { readCssColor } from '@/lib/tokens';
import type { ConflictEvent, ConflictsResponse, CountryRiskResponse, FeedEvent, FrontlinesResponse, GdacsIncident, GdacsResponse, GdeltEvent, GdeltEventsResponse, InfrastructureResponse, NuclearSite } from '@/lib/types';
import { gdeltCoverage, gdeltTitle, QUAD_TOKEN } from '../shared/gdelt';
import { GLOBE_POINT_PARAMETERS, lngLatOf, useFacing } from './globe';
import { rgbaCss, useDeckPick, useFeedData, useNativeLayers, useNativePick } from './hooks';
import { buildRiskGeometry } from './risk-geometry';
import { conflictEventSelection, zoneSelection } from './selection';
import { filterAtCursor, heldSpan, timeMs, useReportCoverage, useTimeCursor } from '@/components/hud/timeline';

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
  const items = useFacing(data?.items, lngLatOf);
  const layers = useMemo(
    () =>
      items
        ? [
            new ScatterplotLayer<NuclearSite>({
              id: 'tn-nuclear',
              data: items,
              parameters: GLOBE_POINT_PARAMETERS,
              getPosition: lngLatOf,
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
  const all = data?.items;
  const push = useFeedEventStore((s) => s.push);
  useEffect(() => {
    if (all) push(gdacsEvents(all));
  }, [all, push]);
  const items = useFacing(all, lngLatOf);
  const layers = useMemo(
    () =>
      items
        ? [
            new ScatterplotLayer<GdacsIncident>({
              id: 'tn-gdacs',
              data: items,
              parameters: GLOBE_POINT_PARAMETERS,
              getPosition: lngLatOf,
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

/** The whole 1 h window (the feed keeps ≤ 5 000 events); `total`/`truncated` say if any were left out. */
export const GDELT_EVENTS_URL = '/api/gdelt-events?limit=5000';

const gdeltObservedMs = (e: GdeltEvent) => timeMs(e.dateAdded);

function GdeltLayer() {
  const data = useFeedData<GdeltEventsResponse>('gdelt_events', GDELT_EVENTS_URL, (b) => b.items.length);
  const all = data?.items;
  const cursor = useTimeCursor();
  // Timeline replay: only events added at or before the cursor (the same array when live).
  const replay = useMemo(() => (all ? filterAtCursor(all, cursor, gdeltObservedMs) : null), [all, cursor]);
  // The feed holds its aggregated 15-minute export windows (window.from → the fetch).
  const from = timeMs(data?.window.from);
  const span = data && from !== null ? heldSpan(data.meta.fetchedAt, null, from) : null;
  useReportCoverage('gdelt_events', span && all && replay ? { ...span, shown: replay.length, total: all.length } : null);
  const coverage = useMemo(() => (data ? gdeltCoverage(data) : null), [data]);
  const push = useFeedEventStore((s) => s.push);
  useEffect(() => {
    if (all) push(gdeltEvents(all));
  }, [all, push]);
  // Material conflict drawn last (on top).
  const sorted = useMemo(() => (replay ? [...replay].sort((a, b) => a.quadClass - b.quadClass) : null), [replay]);
  const items = useFacing(sorted, lngLatOf);
  const layers = useMemo(() => {
    if (!items) return null;
    return [
      new ScatterplotLayer<GdeltEvent>({
        id: 'tn-gdelt',
        data: items,
        parameters: GLOBE_POINT_PARAMETERS,
        getPosition: lngLatOf,
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
    return e ? { kind: 'gdelt_event', id: e.id, layer: 'gdelt_events', source: 'gdelt', observedAt: e.dateAdded, data: { ...e, ...(coverage ? { windowCoverage: coverage } : {}) }, lngLat: [e.lng, e.lat] } : null;
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
  const shownEvents = useFacing(events, lngLatOf);
  const eventLayers = useMemo(
    () =>
      shownEvents
        ? [
            new ScatterplotLayer<ConflictEvent>({
              id: 'tn-zone-events',
              data: shownEvents,
              parameters: GLOBE_POINT_PARAMETERS,
              getPosition: lngLatOf,
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
    [shownEvents],
  );
  useDeckLayers('threats:zone-events', eventLayers, zOf('conflict_zones'));
  // Zone cards are headed by the zone's display name, events name their zone the same way.
  useNativePick(['tn-zones-fill'], (id) => {
    const z = zById.get(id);
    return z ? zoneSelection(z) : null;
  });
  useDeckPick('tn-zone-events', (info) => {
    const e = info.object as ConflictEvent | undefined;
    return e ? conflictEventSelection(e, e.zoneId ? zById.get(e.zoneId) : undefined) : null;
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
// Every row with an INFORM score is drawn (outline, or label point for states too small for the
// 1:110m outlines); WGI-only rows have nothing to shade. The rail counts what is drawn.
const RISK_OPACITY = ['interpolate', ['linear'], ['get', 'score'], 0, 0.02, 3.5, 0.12, 5, 0.25, 6.5, 0.42, 9, 0.6] as unknown as number;
const RISK_POINT_OPACITY = ['interpolate', ['linear'], ['get', 'score'], 0, 0.3, 3.5, 0.45, 5, 0.6, 6.5, 0.75, 9, 0.9] as unknown as number;

function CountryRiskLayer() {
  const shapes = useQuery({
    queryKey: ['zones-countries'],
    queryFn: async () => (await (await fetch('/data/zones-countries.json')).json()) as GeoJSON.FeatureCollection,
    staleTime: Infinity,
  }).data;
  const countDrawn = useCallback((b: CountryRiskResponse) => (shapes ? buildRiskGeometry(b.items, shapes).drawn : null), [shapes]);
  const data = useFeedData<CountryRiskResponse>('country_risk', '/api/country-risk', countDrawn);
  const items = data?.items;
  const byIso = useMemo(() => new Map((items ?? []).map((r) => [r.iso3, r])), [items]);
  const geo = useMemo(() => (shapes && items ? buildRiskGeometry(items, shapes) : null), [shapes, items]);
  const layers = useMemo(
    () => [
      { id: 'tn-risk-fill', type: 'fill' as const, paint: { 'fill-color': css('--map-risk'), 'fill-opacity': RISK_OPACITY } },
      { id: 'tn-risk-line', type: 'line' as const, paint: { 'line-color': css('--map-risk', 0.35), 'line-width': 0.5 } },
    ],
    [],
  );
  const pointLayers = useMemo(
    () => [
      {
        id: 'tn-risk-pt',
        type: 'circle' as const,
        paint: { 'circle-color': css('--map-risk'), 'circle-opacity': RISK_POINT_OPACITY, 'circle-radius': 4.5, 'circle-stroke-color': css('--map-risk', 0.6), 'circle-stroke-width': 0.75 },
      },
    ],
    [],
  );
  useNativeLayers('tn-risk', geo?.polygons ?? null, layers);
  useNativeLayers('tn-risk-pts', geo?.points ?? null, pointLayers);
  useNativePick(['tn-risk-fill', 'tn-risk-pt'], (id) => {
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
