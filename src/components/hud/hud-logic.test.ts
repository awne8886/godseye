import { beforeEach, describe, expect, it } from 'vitest';
import { LAYERS, visibleLayers } from '@/lib/layer-registry';
import { REGION_PRESETS } from '@/lib/presets';
import { DEFAULT_SETTINGS, useUiStore } from '@/lib/store';
import { MOBILE_SHEETS, MOBILE_TABS, PANELS, TOOLS, type PanelId } from '@/lib/tool-registry';
import { formatLatLng, geoCell, metersPerPixel, scaleBar } from './map-readout';
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
  it('an event inherits the feed state (a 2 h old quake on a live feed is LIVE-feed, age shown)', () => {
    const b = cardBadge({ layer: 'earthquakes', observedAt: ago(2 * 3600_000), feed: { state: 'live' }, now: NOW });
    expect(b.state).toBe('live');
    expect(b.age).toBe('2h ago');
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
    expect(metersPerPixel(0, 0)).toBeCloseTo(78271.5, 0);
    const mpp = metersPerPixel(51.5, 10);
    expect(scaleBar(mpp, 100, 'metric')).toMatchObject({ label: '3 KM' });
    expect(scaleBar(mpp, 100, 'imperial')!.label).toMatch(/MI$/);
    expect(scaleBar(mpp, 100, 'aviation')!.label).toMatch(/NM$/);
    expect(scaleBar(mpp, 100, 'metric')!.widthPx).toBeLessThanOrEqual(100);
    expect(scaleBar(Number.NaN, 100, 'metric')).toBeNull();
  });
  it('formats coordinates and 0.1° cache cells', () => {
    expect(formatLatLng(51.5074, -0.1278)).toBe('51.507°N 0.128°W');
    expect(geoCell(51.5074, -0.1278)).toBe('51.5,-0.1');
    expect(geoCell(51.54, -0.16)).toBe('51.5,-0.2');
  });
});
