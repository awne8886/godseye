import { describe, expect, it } from 'vitest';
import { MAX_FEED_EVENTS, orderedDeckLayers, useDeckLayerStore, useFeedEventStore, useLayerStatusStore, useSelectionStore } from './layer-host';
import { DEFAULT_ACTIVE_LAYERS } from './layer-registry';
import { useUiStore } from './store';
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
  it('keeps one open tool, pins panels and sequences fly-to requests', () => {
    const s = useUiStore.getState();
    s.toggleTool('paths');
    expect(useUiStore.getState().openTool).toBe('paths');
    s.toggleTool('paths');
    expect(useUiStore.getState().openTool).toBeNull();
    s.pinPanel('flight-watch');
    s.pinPanel('flight-watch');
    expect(useUiStore.getState().pinnedPanels).toEqual(['flight-watch']);
    s.requestFlyTo({ lng: 1, lat: 2 });
    const a = useUiStore.getState().flyTo!.ts;
    s.requestFlyTo({ lng: 1, lat: 2 });
    expect(useUiStore.getState().flyTo!.ts).toBeGreaterThan(a);
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
    useSelectionStore.getState().select({ kind: 'aircraft', id: '4ca2b3', layer: 'flights', data: {}, lngLat: [0, 0] });
    expect(useSelectionStore.getState().selection?.id).toBe('4ca2b3');
    useSelectionStore.getState().clear();
    expect(useSelectionStore.getState().selection).toBeNull();
  });
});
