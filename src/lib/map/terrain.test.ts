import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TERRAIN_SOURCE_ID } from './imagery';
import { attachTerrain, TERRAIN_SETTLE_MS, type TerrainMap, type TerrainStatus } from './terrain';
import { batchTerrainLayers, drapedOrder, type LayerOrderMap } from './terrain-layer-order';

type Handler = (e?: unknown) => void;

function fakeMap(layers: [string, string][] = [['background', 'background'], ['water', 'fill'], ['place', 'symbol'], ['roads', 'line']]) {
  const handlers = new Map<string, Set<Handler>>();
  const sources = new Map<string, unknown>();
  let order = layers.map(([id]) => id);
  const types = new Map(layers);
  const state = { zoom: 5, moving: false, pixelRatio: 2, terrain: null as { source: string } | null };
  const map = {
    state,
    emit(type: string, e?: unknown) {
      for (const h of handlers.get(type) ?? []) h(e);
    },
    on: vi.fn((type: string, h: Handler) => {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(h);
    }),
    off: vi.fn((type: string, h: Handler) => void handlers.get(type)?.delete(h)),
    listeners: (type: string) => handlers.get(type)?.size ?? 0,
    getZoom: () => state.zoom,
    isMoving: () => state.moving,
    getPixelRatio: () => state.pixelRatio,
    setPixelRatio: vi.fn((r: number) => void (state.pixelRatio = r)),
    addSource: vi.fn((id: string, spec: unknown) => void sources.set(id, spec)),
    getSource: (id: string) => sources.get(id),
    removeSource: vi.fn((id: string) => void sources.delete(id)),
    setTerrain: vi.fn((t: { source: string } | null) => void (state.terrain = t)),
    getTerrain: () => state.terrain,
    setSourceTileLodParams: vi.fn(),
    getLayersOrder: () => [...order],
    getLayer: (id: string) => (types.has(id) ? { type: types.get(id)! } : undefined),
    moveLayer: vi.fn((id: string, before?: string) => {
      order = order.filter((x) => x !== id);
      order.splice(before ? order.indexOf(before) : order.length, 0, id);
    }),
    addLayer(id: string, type: string) {
      types.set(id, type);
      order.push(id);
    },
    sources,
  };
  return map;
}

describe('terrain engage/release state machine', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(zoom = 5) {
    const map = fakeMap();
    map.state.zoom = zoom;
    const statuses: TerrainStatus[] = [];
    const engaged: boolean[] = [];
    const detach = attachTerrain(map as unknown as TerrainMap, { onStatus: (s) => statuses.push(s), onEngagedChange: (e) => engaged.push(e), isHidden: () => false });
    return { map, statuses, engaged, detach };
  }

  it('stays idle below z 10', () => {
    const { map, statuses } = setup(9.9);
    vi.advanceTimersByTime(5000);
    expect(statuses).toEqual(['idle']);
    expect(map.addSource).not.toHaveBeenCalled();
  });

  it('engages at z ≥ 10 only after a 500 ms settle, in mercator, pitch/pixel-ratio capped', () => {
    const { map, statuses, engaged } = setup(5);
    map.state.zoom = 10;
    map.emit('moveend');
    expect(statuses.at(-1)).toBe('waiting');
    vi.advanceTimersByTime(TERRAIN_SETTLE_MS - 1);
    expect(map.addSource).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(engaged).toEqual([true]);
    expect(map.addSource).toHaveBeenCalledWith(TERRAIN_SOURCE_ID, expect.objectContaining({ type: 'raster-dem', encoding: 'terrarium', tileSize: 256 }));
    expect(map.setTerrain).toHaveBeenCalledWith({ source: TERRAIN_SOURCE_ID, exaggeration: 1 });
    expect(map.setPixelRatio).toHaveBeenCalledWith(1.5);
    expect(statuses.at(-1)).toBe('loading');
    map.emit('sourcedata', { sourceId: TERRAIN_SOURCE_ID, isSourceLoaded: true, tile: {} });
    expect(statuses.at(-1)).toBe('ready');
  });

  it('restarts the settle timer on every movement', () => {
    const { map } = setup(11);
    vi.advanceTimersByTime(400);
    map.emit('movestart');
    map.state.moving = true;
    vi.advanceTimersByTime(400);
    map.state.moving = false;
    map.emit('moveend');
    vi.advanceTimersByTime(400);
    expect(map.addSource).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(map.addSource).toHaveBeenCalledTimes(1);
  });

  it('keeps terrain between z 9.5 and 10 (hysteresis) and releases below 9.5', () => {
    const { map, engaged, statuses } = setup(10.5);
    vi.advanceTimersByTime(TERRAIN_SETTLE_MS);
    map.state.zoom = 9.7;
    map.emit('zoom');
    expect(map.removeSource).not.toHaveBeenCalled();
    map.state.zoom = 9.4;
    map.emit('zoom');
    expect(map.setTerrain).toHaveBeenLastCalledWith(null);
    expect(map.removeSource).toHaveBeenCalledWith(TERRAIN_SOURCE_ID);
    expect(map.state.pixelRatio).toBe(2);
    expect(engaged).toEqual([true, false]);
    expect(statuses.at(-1)).toBe('idle');
  });

  it('cancels a pending engage when zooming back out, and stops on a source error', async () => {
    const { map, statuses } = setup(10.2);
    map.state.zoom = 9;
    map.emit('zoom');
    vi.advanceTimersByTime(1000);
    expect(map.addSource).not.toHaveBeenCalled();
    map.state.zoom = 12;
    map.emit('moveend');
    vi.advanceTimersByTime(TERRAIN_SETTLE_MS);
    map.emit('error', { sourceId: TERRAIN_SOURCE_ID });
    await Promise.resolve();
    expect(statuses.at(-1)).toBe('error');
    expect(map.removeSource).toHaveBeenCalled();
    map.emit('moveend');
    vi.advanceTimersByTime(TERRAIN_SETTLE_MS);
    expect(map.addSource).toHaveBeenCalledTimes(1); // failed: no retry loop
  });

  it('detaches cleanly (listeners off, terrain removed)', () => {
    const { map, detach, engaged } = setup(12);
    vi.advanceTimersByTime(TERRAIN_SETTLE_MS);
    detach();
    expect(map.listeners('zoom')).toBe(0);
    expect(map.listeners('moveend')).toBe(0);
    expect(map.state.terrain).toBeNull();
    expect(engaged).toEqual([true, false]);
    detach();
  });

  it('never engages while the tab is hidden', () => {
    const map = fakeMap();
    map.state.zoom = 12;
    attachTerrain(map as unknown as TerrainMap, { isHidden: () => true });
    vi.advanceTimersByTime(2000);
    expect(map.addSource).not.toHaveBeenCalled();
  });
});

describe('draped layer order', () => {
  it('batches ground layers below overlays, stable within each group', () => {
    const types: Record<string, string> = { a: 'fill', b: 'symbol', c: 'line', d: 'circle', e: 'raster' };
    expect(drapedOrder(['a', 'b', 'c', 'd', 'e'], (id) => types[id])).toEqual(['a', 'c', 'e', 'b', 'd']);
  });

  it('reorders on attach and restores (keeping newly added layers) on release', () => {
    const map = fakeMap();
    const restore = batchTerrainLayers(map as unknown as LayerOrderMap);
    expect(map.getLayersOrder()).toEqual(['background', 'water', 'roads', 'place']);
    map.addLayer('deck-quakes', 'custom');
    map.emit('styledata');
    expect(map.getLayersOrder()).toEqual(['background', 'water', 'roads', 'place', 'deck-quakes']);
    restore();
    expect(map.getLayersOrder()).toEqual(['background', 'water', 'place', 'roads', 'deck-quakes']);
    expect(map.listeners('styledata')).toBe(0);
  });
});
