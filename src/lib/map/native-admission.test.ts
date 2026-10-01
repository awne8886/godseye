import { describe, expect, it, vi } from 'vitest';
import { installNativeAdmission, type NativeMapLike } from './native-admission';
import { onceBasemapPainted, type PaintMap } from './ready';

type L = { id: string; type: string; layout?: Record<string, unknown> };

/** A style-backed fake map: layers live in an ordered list; visibility is a layout property. */
function fakeMap(basemap: L[]) {
  const layers: L[] = basemap.map((l) => ({ ...l, layout: { ...l.layout } }));
  const find = (id: string) => layers.find((l) => l.id === id);
  const map: NativeMapLike = {
    addLayer: (layer: never) => {
      const l = layer as unknown as L;
      layers.push({ ...l, layout: { ...l.layout } });
      return map;
    },
    removeLayer: (id: string) => {
      const i = layers.findIndex((l) => l.id === id);
      if (i >= 0) layers.splice(i, 1);
      return map;
    },
    setLayoutProperty: (id: string, name: string, value: unknown) => {
      const l = find(id);
      if (l) l.layout = { ...l.layout, [name]: value };
      return map;
    },
    getLayoutProperty: (id: string, name: string) => find(id)?.layout?.[name],
    getLayer: (id: string) => find(id),
    getStyle: () => ({ layers }),
  };
  const drawnVisibility = (id: string) => find(id)?.layout?.visibility ?? 'visible';
  return { map, layers, drawnVisibility };
}

const BASEMAP: L[] = [
  { id: 'bg', type: 'background' },
  { id: 'water', type: 'fill' },
  { id: 'roads', type: 'line' },
  { id: 'labels', type: 'symbol' },
];

describe('native layer admission (perf B2: one new MapLibre program per slot)', () => {
  it('passes layer types the basemap already draws, holds new types hidden', () => {
    const { map, drawnVisibility } = fakeMap(BASEMAP);
    const onChange = vi.fn();
    const a = installNativeAdmission(map, onChange);
    map.addLayer({ id: 'zones', type: 'fill', source: 's' } as never);
    map.addLayer({ id: 'quakes', type: 'circle', source: 's' } as never);
    map.addLayer({ id: 'heat', type: 'heatmap', source: 's' } as never);
    map.addLayer({ id: 'quake-halo', type: 'circle', source: 's' } as never);
    expect(drawnVisibility('zones')).toBe('visible');
    expect(drawnVisibility('quakes')).toBe('none');
    expect(drawnVisibility('heat')).toBe('none');
    // The caller still sees its own visibility.
    expect(map.getLayoutProperty('quakes', 'visibility')).toBe('visible');
    expect(a.pendingTypes()).toEqual(['circle', 'heatmap']);
    expect(onChange).toHaveBeenCalled();

    expect(a.admitNext()).toBe('circle');
    expect(drawnVisibility('quakes')).toBe('visible');
    expect(drawnVisibility('quake-halo')).toBe('visible');
    expect(drawnVisibility('heat')).toBe('none');
    expect(a.admitNext()).toBe('heatmap');
    expect(drawnVisibility('heat')).toBe('visible');
    expect(a.admitNext()).toBeNull();
    // Admitted types pass straight through afterwards.
    map.addLayer({ id: 'quakes-2', type: 'circle', source: 's' } as never);
    expect(drawnVisibility('quakes-2')).toBe('visible');
  });

  it('never gates deck custom layers or layers added hidden; honours visibility set while held', () => {
    const { map, drawnVisibility } = fakeMap(BASEMAP);
    const a = installNativeAdmission(map, () => undefined);
    map.addLayer({ id: 'deck-1', type: 'custom' } as never);
    map.addLayer({ id: 'sat', type: 'raster', source: 'esri', layout: { visibility: 'none' } } as never);
    map.addLayer({ id: 'bld', type: 'fill-extrusion', source: 's' } as never);
    expect(drawnVisibility('deck-1')).toBe('visible');
    expect(drawnVisibility('sat')).toBe('none');
    expect(a.pendingTypes()).toEqual(['fill-extrusion']);
    // A hidden raster switched on later waits for its type's slot.
    map.setLayoutProperty('sat', 'visibility', 'visible');
    expect(drawnVisibility('sat')).toBe('none');
    expect(map.getLayoutProperty('sat', 'visibility')).toBe('visible');
    // The user hides the extrusion before it was admitted: it stays hidden after admission.
    map.setLayoutProperty('bld', 'visibility', 'none');
    expect(a.admitNext()).toBe('fill-extrusion');
    expect(drawnVisibility('bld')).toBe('none');
    expect(a.admitNext()).toBe('raster');
    expect(drawnVisibility('sat')).toBe('visible');
  });

  it('removing a held layer drops its pending type; uninstall reveals everything and restores methods', () => {
    const { map, drawnVisibility } = fakeMap(BASEMAP);
    const orig = map.addLayer;
    const a = installNativeAdmission(map, () => undefined);
    map.addLayer({ id: 'radar', type: 'raster', source: 'r' } as never);
    map.removeLayer('radar');
    expect(a.pendingTypes()).toEqual([]);
    map.addLayer({ id: 'heat', type: 'heatmap', source: 's' } as never);
    a.uninstall();
    expect(drawnVisibility('heat')).toBe('visible');
    expect(map.addLayer).toBe(orig);
  });
});

describe('onceBasemapPainted (visual-qa R2-M6: features wait for the first globe frame, capped)', () => {
  function paintMap(loaded = false) {
    const handlers = new Map<string, Set<(e?: { sourceId?: string; tile?: unknown }) => void>>();
    const m: PaintMap = {
      on: (t, fn) => handlers.set(t, (handlers.get(t) ?? new Set()).add(fn)),
      off: (t, fn) => handlers.get(t)?.delete(fn),
      loaded: () => loaded,
    };
    const emit = (t: string, e?: { sourceId?: string; tile?: unknown }) => [...(handlers.get(t) ?? [])].forEach((f) => f(e));
    return { m, emit, handlers };
  }
  const timers = () => {
    const q: (() => void)[] = [];
    return { q, t: { setTimeout: (cb: () => void) => q.push(cb), clearTimeout: () => void (q.length = 0) } };
  };

  it('fires on the first render after a basemap tile, once', () => {
    const { m, emit } = paintMap();
    const cb = vi.fn();
    const { t } = timers();
    onceBasemapPainted(m, 'openmaptiles', cb, 4000, t);
    emit('render');
    emit('sourcedata', { sourceId: 'other', tile: {} });
    emit('render');
    expect(cb).not.toHaveBeenCalled();
    emit('sourcedata', { sourceId: 'openmaptiles', tile: {} });
    emit('render');
    emit('render');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('fires at the cap when no tile ever arrives, and immediately when already loaded', () => {
    const { m } = paintMap();
    const cb = vi.fn();
    const { q, t } = timers();
    onceBasemapPainted(m, 'openmaptiles', cb, 4000, t);
    q[0]!();
    expect(cb).toHaveBeenCalledTimes(1);
    const done = vi.fn();
    onceBasemapPainted(paintMap(true).m, 'openmaptiles', done, 4000, timers().t);
    expect(done).toHaveBeenCalledTimes(1);
  });
});
