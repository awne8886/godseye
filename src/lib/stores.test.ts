import { describe, expect, it } from 'vitest';
import { MAX_FEED_EVENTS, orderedDeckLayers, useDeckLayerStore, useFeedEventStore, useLayerStatusStore, useSelectionStore } from './layer-host';
import { DEFAULT_ACTIVE_LAYERS } from './layer-registry';
import { DEFAULT_SETTINGS, MAX_WATCHED_FLIGHTS, sanitizeSettings, useUiStore } from './store';
import type { FeedEvent } from './types';

describe('UI store', () => {
  it('starts with the registry defaults and toggles layers immutably', () => {
    const s = useUiStore.getState();
    expect([...s.activeLayers].sort()).toEqual([...DEFAULT_ACTIVE_LAYERS].sort());
    const before = s.activeLayers;
    s.toggleLayer('fires');
    expect(useUiStore.getState().activeLayers.has('fires')).toBe(true);
    expect(before.has('fires')).toBe(false);
    s.setLayer('fires', false);
    expect(useUiStore.getState().activeLayers.has('fires')).toBe(false);
  });
  it('keeps one open panel, pins panels and sequences fly-to requests', () => {
    const s = useUiStore.getState();
    s.togglePanel('paths');
    expect(useUiStore.getState().openPanel).toBe('paths');
    s.togglePanel('paths');
    expect(useUiStore.getState().openPanel).toBeNull();
    s.pinPanel('flight-watch');
    s.pinPanel('flight-watch');
    expect(useUiStore.getState().pinnedPanels).toEqual(['flight-watch']);
    s.requestFlyTo({ lng: 1, lat: 2 });
    const a = useUiStore.getState().flyTo!.ts;
    s.requestFlyTo({ lng: 1, lat: 2 });
    expect(useUiStore.getState().flyTo!.ts).toBeGreaterThan(a);
  });
});

describe('UI store: dossier, watch list, settings', () => {
  it('opens and closes the dossier with its target', () => {
    const s = useUiStore.getState();
    s.openDossier({ lat: 50.45, lng: 30.52 });
    expect(useUiStore.getState()).toMatchObject({ openPanel: 'dossier', dossierTarget: { lat: 50.45, lng: 30.52 } });
    s.closeDossier();
    expect(useUiStore.getState()).toMatchObject({ openPanel: null, dossierTarget: null });
  });
  it('caps the watch list at MAX_WATCHED_FLIGHTS, normalises and rejects non-hex ids', () => {
    const s = useUiStore.getState();
    for (const h of ['A00001', 'a00002', 'a00003', 'a00004', 'a00005', 'a00006', 'a00007']) s.watchFlight(h);
    s.watchFlight('a00007');
    s.watchFlight('BAW117');
    expect(useUiStore.getState().watchedFlights).toHaveLength(MAX_WATCHED_FLIGHTS);
    expect(useUiStore.getState().watchedFlights[0]).toBe('a00002');
    s.unwatchFlight('A00007');
    expect(useUiStore.getState().watchedFlights).not.toContain('a00007');
  });
  it('merges settings and sanitises persisted values', () => {
    useUiStore.getState().updateSettings({ units: 'metric' });
    expect(useUiStore.getState().settings).toEqual({ ...DEFAULT_SETTINGS, units: 'metric' });
    expect(sanitizeSettings({ units: 'furlongs' as never, previewAutoplay: 'yes' as never, geoConsent: 'granted' })).toEqual({ ...DEFAULT_SETTINGS, geoConsent: 'granted' });
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });
});

describe('layer host stores', () => {
  it('orders published deck layers by z and removes them', () => {
    const { set, remove } = useDeckLayerStore.getState();
    set('b', { layers: ['B' as never], z: 50 });
    set('a', { layers: ['A' as never], z: 10 });
    expect(orderedDeckLayers(useDeckLayerStore.getState().entries)).toEqual(['A', 'B']);
    remove('a');
    remove('missing');
    expect(orderedDeckLayers(useDeckLayerStore.getState().entries)).toEqual(['B']);
  });
  it('merges layer status patches', () => {
    const { update } = useLayerStatusStore.getState();
    update('earthquakes', { state: 'loading' });
    update('earthquakes', { state: 'live', count: 42 });
    expect(useLayerStatusStore.getState().status.earthquakes).toMatchObject({ state: 'live', count: 42, fetchedAt: null });
  });
  it('dedupes, sorts newest-first and caps Intel Feed events', () => {
    const ev = (i: number): FeedEvent => ({ id: `e${i}`, layer: 'earthquakes', entityKind: 'earthquake', entityId: `q${i}`, title: `M${i}`, severity: 'low', observedAt: new Date(Date.UTC(2026, 8, 30, 0, 0, i)).toISOString(), source: 'usgs' });
    const { push } = useFeedEventStore.getState();
    push([ev(1), ev(2)]);
    push([ev(2), ev(3)]);
    expect(useFeedEventStore.getState().events.map((e) => e.id)).toEqual(['e3', 'e2', 'e1']);
    push(Array.from({ length: MAX_FEED_EVENTS + 10 }, (_, i) => ev(i + 10)));
    expect(useFeedEventStore.getState().events).toHaveLength(MAX_FEED_EVENTS);
  });
  it('selects and clears the entity card', () => {
    useSelectionStore.getState().select({ kind: 'aircraft', id: '4ca2b3', layer: 'flights', source: 'adsblol', observedAt: '2026-09-30T16:00:00Z', data: {}, lngLat: [0, 0] });
    expect(useSelectionStore.getState().selection?.id).toBe('4ca2b3');
    useSelectionStore.getState().clear();
    expect(useSelectionStore.getState().selection).toBeNull();
  });
});
