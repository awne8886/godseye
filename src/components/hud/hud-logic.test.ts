import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LAYERS, visibleLayers } from '@/lib/layer-registry';
import { REGION_PRESETS } from '@/lib/presets';
import { DEFAULT_SETTINGS, useUiStore } from '@/lib/store';
import { MOBILE_SHEETS, MOBILE_TABS, PANELS, TOOLS, type PanelId } from '@/lib/tool-registry';
import { formatLatLng, geoCell, scaleBarFor } from './map-readout';
import { paletteItems } from './palette-items';
import { ALL_PANEL_IDS, MODAL_PANELS, mobileReachable, panelLabel, tabForPanel } from './panel-meta';
import { feedsReady, splashStage } from './splash-logic';
import { activeVisible, cardBadge, hudStatus, refreshLabel } from './status-logic';

const NOW = Date.parse('2026-09-30T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('STATUS logic (LIVE only with ≥ 1 live active layer)', () => {
  const visible = new Set(LAYERS.map((l) => l.id));
  it('is LIVE only when an active, visible, non-reference layer is live', () => {
    expect(hudStatus({ active: new Set(['earthquakes']), visible, status: { earthquakes: { state: 'live' } }, health: 'ok' })).toBe('LIVE');
    expect(hudStatus({ active: new Set(['earthquakes']), visible, status: { earthquakes: { state: 'recent' } }, health: 'ok' })).toBe('DELAYED');
    expect(hudStatus({ active: new Set(['earthquakes']), visible, status: { earthquakes: { state: 'loading' } }, health: 'ok' })).toBe('ACQUIRING');
    expect(hudStatus({ active: new Set(['earthquakes']), visible, status: { earthquakes: { state: 'offline' } }, health: 'ok' })).toBe('OFFLINE');
  });
  it('never goes LIVE from reference layers, inactive layers or capability-hidden layers', () => {
    expect(hudStatus({ active: new Set(['day_night']), visible, status: { day_night: { state: 'live' } }, health: 'ok' })).toBe('STANDBY');
    expect(hudStatus({ active: new Set(), visible, status: { earthquakes: { state: 'live' } }, health: 'ok' })).toBe('STANDBY');
    const noNc = new Set(visibleLayers({ nc_sources: { enabled: false } }).map((l) => l.id));
    expect(hudStatus({ active: new Set(['malware']), visible: noNc, status: { malware: { state: 'live' } }, health: 'ok' })).toBe('STANDBY');
  });
  it('reports health failures and loading honestly', () => {
    expect(hudStatus({ active: new Set(['earthquakes']), visible, status: { earthquakes: { state: 'live' } }, health: 'error' })).toBe('OFFLINE');
    expect(hudStatus({ active: new Set(['earthquakes']), visible, status: {}, health: 'loading' })).toBe('CONNECTING');
  });
  it('layer count excludes capability-hidden layers', () => {
    const noNc = new Set(visibleLayers({ nc_sources: { enabled: false } }).map((l) => l.id));
    expect(activeVisible(new Set(['sdk_sea', 'earthquakes', 'malware']), noNc)).toEqual(['earthquakes']);
  });
});

describe('entity card freshness badge', () => {
  it('aircraft observed 20 s ago on a live feed is LIVE', () => {
    expect(cardBadge({ layer: 'flights', observedAt: ago(20_000), feed: { state: 'live' }, now: NOW })).toMatchObject({ state: 'live', label: 'LIVE' });
  });
  it('aircraft observed 5 min ago is shown with its age, then STALE', () => {
    expect(cardBadge({ layer: 'flights', observedAt: ago(5 * 60_000), feed: { state: 'live' }, now: NOW })).toMatchObject({ state: 'recent', label: '5m' });
    expect(cardBadge({ layer: 'flights', observedAt: ago(20 * 60_000), feed: { state: 'live' }, now: NOW })).toMatchObject({ state: 'stale', label: 'STALE' });
  });
  it('an event inherits the feed state only within one refresh interval; older events are RECENT with their age', () => {
    const fresh = cardBadge({ layer: 'earthquakes', observedAt: ago(30_000), feed: { state: 'live' }, now: NOW });
    expect(fresh.state).toBe('live');
    const b = cardBadge({ layer: 'earthquakes', observedAt: ago(2 * 3600_000), feed: { state: 'live' }, now: NOW });
    expect(b.state).toBe('recent');
    expect(b.age).toBe('2h ago');
    const quake16h = cardBadge({ layer: 'earthquakes', observedAt: ago(16 * 3600_000), feed: { state: 'live' }, now: NOW });
    expect(quake16h.state).not.toBe('live');
    expect(quake16h.label).not.toBe('LIVE');
  });
  it('an idle zoom-gated layer reads ZOOM ≥ N, nothing else does', async () => {
    const { zoomGateLabel } = await import('./status-logic');
    expect(zoomGateLabel({ state: 'idle', error: 'zoom_min_6' })).toBe('ZOOM ≥ 6');
    expect(zoomGateLabel({ state: 'idle', error: 'http_503' })).toBeNull();
    expect(zoomGateLabel({ state: 'offline', error: 'zoom_min_6' })).toBeNull();
    expect(zoomGateLabel({ state: 'idle' })).toBeNull();
    expect(zoomGateLabel(undefined)).toBeNull();
  });
  it('offline feed → OFFLINE; reference layer → REFERENCE', () => {
    expect(cardBadge({ layer: 'earthquakes', observedAt: ago(1000), feed: { state: 'offline' }, now: NOW }).label).toBe('OFFLINE');
    expect(cardBadge({ layer: 'infrastructure', observedAt: null, feed: { state: 'live' }, now: NOW }).label).toBe('REFERENCE');
  });
  it('never LIVE without an observation time or before the feed has reported', () => {
    expect(cardBadge({ layer: 'earthquakes', observedAt: null, feed: { state: 'live' }, now: NOW }).state).not.toBe('live');
    expect(cardBadge({ layer: 'earthquakes', observedAt: ago(1000), feed: { state: 'loading' }, now: NOW }).state).toBe('recent');
    expect(cardBadge({ layer: 'flights', observedAt: ago(1000), feed: undefined, now: NOW }).state).toBe('recent');
  });
  it('future timestamps are never LIVE', () => {
    expect(cardBadge({ layer: 'earthquakes', observedAt: new Date(NOW + 10 * 60_000).toISOString(), feed: { state: 'live' }, now: NOW }).state).toBe('stale');
  });
});

describe('refresh labels', () => {
  it('formats intervals and transports', () => {
    expect(refreshLabel(15_000, 'poll')).toBe('15S');
    expect(refreshLabel(120 * 60_000, 'poll')).toBe('2H');
    expect(refreshLabel(null, 'sse')).toBe('STREAM');
    expect(refreshLabel(null, 'static')).toBe('STATIC');
    expect(refreshLabel(null, 'none')).toBe('LOCAL');
  });
});

describe('mobile sheet coverage', () => {
  it('every TOOLS and PANELS id is reachable from the phone nav, except map/card-launched panels', () => {
    const reachable = mobileReachable();
    const contextual = new Set<string>(PANELS.filter((p) => p.launcher === 'card' || p.launcher === 'map').map((p) => p.id));
    for (const t of TOOLS) expect(reachable.has(t.id), t.id).toBe(true);
    for (const p of PANELS) if (!contextual.has(p.id) && p.id !== 'help' && p.id !== 'palette') expect(reachable.has(p.id), p.id).toBe(true);
  });
  it('every tab maps to a sheet whose panels resolve back to that tab', () => {
    for (const tab of MOBILE_TABS) for (const p of MOBILE_SHEETS[tab]) expect(tabForPanel(p as PanelId)).toBe(tab);
  });
  it('labels every panel and knows the modal set', () => {
    for (const id of ALL_PANEL_IDS) expect(panelLabel(id)).toMatch(/^[A-Z&. ]+$/);
    expect([...MODAL_PANELS].sort()).toEqual(['help', 'palette', 'style-studio']);
  });
});

describe('command palette items', () => {
  beforeEach(() => useUiStore.setState({ openPanel: null, settings: DEFAULT_SETTINGS, camera: { lat: 10, lng: 20, zoom: 3, pitch: 0, bearing: 0 } }));
  const all = () => paletteItems({ available: () => true, layers: [...LAYERS], active: new Set(['earthquakes']) });

  it('lists tools, panels, layers, every region preset and the dossier action', () => {
    const items = all();
    const ids = new Set(items.map((i) => i.id));
    for (const t of TOOLS) expect(ids.has(`tool:${t.id}`), t.id).toBe(true);
    for (const r of REGION_PRESETS) expect(ids.has(`region:${r.id}`), r.id).toBe(true);
    for (const l of LAYERS) expect(ids.has(`layer:${l.id}`), l.id).toBe(true);
    expect(ids.has('action:dossier')).toBe(true);
    expect(ids.has('panel:palette')).toBe(false);
    expect(ids.has('panel:camera')).toBe(false);
    expect(items.find((i) => i.id === 'layer:earthquakes')?.label).toBe('Hide Earthquakes');
  });
  it('hides tools whose panel is not registered', () => {
    const items = paletteItems({ available: (id) => id === 'share', layers: [], active: new Set() });
    expect(items.filter((i) => i.group === 'TOOLS')).toEqual([]);
    expect(items.filter((i) => i.group === 'PANELS').map((i) => i.id)).toEqual(['panel:share']);
  });
  it('"Dossier at map centre" opens the dossier at the camera centre', () => {
    all().find((i) => i.id === 'action:dossier')!.run();
    expect(useUiStore.getState().openPanel).toBe('dossier');
    expect(useUiStore.getState().dossierTarget).toEqual({ lat: 10, lng: 20 });
  });
  it('region items fly the camera', () => {
    all().find((i) => i.id === 'region:ukraine')!.run();
    expect(useUiStore.getState().flyTo).toMatchObject({ lat: 49, lng: 32, zoom: 6 });
  });
});

describe('splash readiness', () => {
  it('needs map idle + two answered feeds (or all when fewer are on) after the minimum time', () => {
    const active = new Set(['earthquakes', 'cctv', 'day_night']);
    expect(feedsReady(active, { earthquakes: { state: 'live' } })).toBe(false);
    expect(feedsReady(active, { earthquakes: { state: 'live' }, cctv: { state: 'offline' } })).toBe(true);
    expect(feedsReady(new Set(['day_night']), {})).toBe(true);
    expect(splashStage({ elapsedMs: 500, mapReady: false, feedsReady: false })).toBe(0);
    expect(splashStage({ elapsedMs: 1500, mapReady: false, feedsReady: true })).toBe(1);
    expect(splashStage({ elapsedMs: 1500, mapReady: true, feedsReady: true })).toBe(2);
    expect(splashStage({ elapsedMs: 2500, mapReady: true, feedsReady: false })).toBe(2);
    expect(splashStage({ elapsedMs: 2500, mapReady: true, feedsReady: true })).toBe(3);
  });
});

describe('scale bar and cursor readout', () => {
  it('computes ground resolution and a round scale in each unit system', () => {
    expect(scaleBarFor(51.5, 10, 100, 'metric')).toMatchObject({ label: '2 KM' });
    expect(scaleBarFor(51.5, 16, 100, 'metric')!.label).toMatch(/^\d+ M$/);
    expect(scaleBarFor(51.5, 10, 100, 'imperial')!.label).toMatch(/MI$/);
    expect(scaleBarFor(51.5, 10, 100, 'aviation')!.label).toMatch(/NM$/);
    expect(scaleBarFor(51.5, 16, 100, 'aviation')!.label).toMatch(/FT$/);
    for (const u of ['metric', 'imperial', 'aviation'] as const) expect(scaleBarFor(51.5, 10, 100, u)!.widthPx).toBeLessThanOrEqual(100);
    expect(scaleBarFor(Number.NaN, 3, 100, 'metric')).toBeNull();
  });
  it('formats coordinates and 0.1° cache cells', () => {
    expect(formatLatLng(51.5074, -0.1278)).toBe('51.507°N 0.128°W');
    expect(geoCell(51.5074, -0.1278)).toBe('51.5,-0.1');
    expect(geoCell(51.54, -0.16)).toBe('51.5,-0.2');
  });
});

describe('palette query items (Flight Path Planner shortcuts)', () => {
  it('turns a typed route or flight into a PATHS action, and nothing else', async () => {
    const { queryItems } = await import('./palette-items');
    const { useUiStore } = await import('@/lib/store');
    const all = () => true;
    const [plan] = queryItems('lhr jfk', all);
    expect(plan!.label).toBe('Plan route LHR → JFK');
    plan!.run();
    expect(useUiStore.getState()).toMatchObject({ plannedRoute: { from: 'LHR', to: 'JFK' }, openPanel: 'paths' });
    const [track] = queryItems('ba117', all);
    expect(track!.label).toBe('Track flight BA117');
    track!.run();
    expect(useUiStore.getState().flightIdent).toBe('BA117');
    expect(queryItems('satellites', all)).toEqual([]);
    expect(queryItems('LHR JFK', (id) => id !== 'paths')).toEqual([]);
    useUiStore.getState().setOpenPanel(null);
  });

  it('parses code routes in every accepted form', async () => {
    const { parseRouteQuery } = await import('./palette-items');
    for (const q of ['LHR JFK', 'lhr-jfk', 'LHR-JFK', 'LHR to JFK', 'lhr → jfk', 'LHR->JFK', 'EGLL→KJFK'])
      expect(parseRouteQuery(q), q).toMatchObject({ kind: 'codes' });
    expect(parseRouteQuery('EGLL→KJFK')).toEqual({ kind: 'codes', from: 'EGLL', to: 'KJFK' });
    expect(parseRouteQuery('LHR to JFK')).toEqual({ kind: 'codes', from: 'LHR', to: 'JFK' });
  });

  it('turns "London to New York" into a route command that resolves each city', async () => {
    const { parseRouteQuery, queryItems } = await import('./palette-items');
    const { useUiStore } = await import('@/lib/store');
    expect(parseRouteQuery('London to New York')).toEqual({ kind: 'names', from: 'London', to: 'New York' });
    expect(parseRouteQuery('Paris → Tokyo')).toEqual({ kind: 'names', from: 'Paris', to: 'Tokyo' });
    expect(parseRouteQuery('London to London')).toBeNull();
    // Recorded /api/airports/search answers (2026-09-30): London → metro LHR…, New York → metro JFK….
    const fetchImpl = (async (url: string) => {
      const q = new URL(url, 'http://x').searchParams.get('q');
      const metro = q === 'London' ? { name: 'London', codes: ['LHR', 'LGW', 'STN', 'LTN', 'LCY', 'SEN'] } : q === 'New York' ? { name: 'New York', codes: ['JFK', 'EWR', 'LGA'] } : null;
      return new Response(JSON.stringify({ query: q, results: [], metro }), { status: 200 });
    }) as unknown as typeof fetch;
    const [item] = queryItems('London to New York', () => true, fetchImpl);
    expect(item!.label).toBe('Plan route LONDON → NEW YORK');
    useUiStore.setState({ plannedRoute: null, openPanel: null });
    item!.run();
    expect(useUiStore.getState().openPanel).toBe('paths');
    await vi.waitFor(() => expect(useUiStore.getState().plannedRoute).toEqual({ from: 'LHR', to: 'JFK' }));
    useUiStore.setState({ plannedRoute: null, openPanel: null, flightIdent: null });
  });

  it('tracks registrations and hex without a digit gate, but never plain words', async () => {
    const { parseFlightQuery, queryItems } = await import('./palette-items');
    expect(parseFlightQuery('G-XWBA')).toBe('G-XWBA');
    expect(parseFlightQuery('vh-oqa')).toBe('VH-OQA');
    expect(parseFlightQuery('4ca2b3')).toBe('4CA2B3');
    expect(parseFlightQuery('BAW117')).toBe('BAW117');
    expect(parseFlightQuery('N12345')).toBe('N12345');
    for (const w of ['LAYERS', 'NOIR', 'NEWS', 'satellites', 'ghost']) expect(parseFlightQuery(w), w).toBeNull();
    const [track] = queryItems('G-XWBA', () => true);
    expect(track!.label).toBe('Track flight G-XWBA');
  });

  it('ranks typed commands, then exact labels, then prefixes, then fuzzy matches', async () => {
    const { rankItem } = await import('./palette-items');
    const layers = rankItem({ id: 'tool:layers', label: 'LAYERS' }, 'LAYERS', 0.5);
    const arcgis = rankItem({ id: 'tool:arcgis', label: 'ARCGIS' }, 'LAYERS', 0.99);
    const show = rankItem({ id: 'layer:flights', label: 'Show Commercial' }, 'LAYERS', 0.3);
    expect(layers).toBeGreaterThan(arcgis);
    expect(layers).toBeGreaterThan(show);
    expect(rankItem({ id: 'route:LHR-JFK', label: 'Plan route LHR → JFK' }, 'lhr jfk', 0)).toBe(1);
    expect(rankItem({ id: 'tool:share', label: 'SHARE' }, 'sh', 0.8)).toBeGreaterThan(rankItem({ id: 'action:ghost', label: 'Toggle Ghost Protocol' }, 'sh', 0.8));
    expect(rankItem({ id: 'tool:share', label: 'SHARE' }, 'zzz', 0)).toBe(0);
  });
});
