// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { afterEach, describe, expect, it } from 'vitest';
import { useMapInstanceStore } from '@/lib/layer-host';
import { renderedFeatureId, useGeoJsonLayers, type GeoJsonLayerSpec } from './use-geojson-layers';

/** A minimal in-memory stand-in for the MapLibre style API the hook touches. */
function fakeMap() {
  const layers: { id: string; type: string; source?: string; before?: string; paint?: Record<string, unknown> }[] = [
    { id: 'water', type: 'fill' },
    { id: 'place-label', type: 'symbol' },
  ];
  const sources = new Map<string, { data: unknown; setData: (d: unknown) => void }>();
  const handlers = new Map<string, Set<() => void>>();
  const paintCalls: [string, string, unknown][] = [];
  let styleLoaded = true;
  const map = {
    getStyle: () => (styleLoaded ? { layers: layers.map(({ id, type }) => ({ id, type })) } : undefined),
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, spec: { data: unknown }) => {
      const s = { data: spec.data, setData: (d: unknown) => void (s.data = d) };
      sources.set(id, s);
    },
    removeSource: (id: string) => void sources.delete(id),
    getLayer: (id: string) => layers.find((l) => l.id === id),
    addLayer: (spec: { id: string; type: string; source: string; paint?: Record<string, unknown> }, before?: string) => {
      const at = before ? layers.findIndex((l) => l.id === before) : layers.length;
      layers.splice(at < 0 ? layers.length : at, 0, { ...spec, before });
    },
    removeLayer: (id: string) => void layers.splice(layers.findIndex((l) => l.id === id), 1),
    setPaintProperty: (id: string, k: string, v: unknown) => void paintCalls.push([id, k, v]),
    on: (ev: string, fn: () => void) => void (handlers.get(ev) ?? handlers.set(ev, new Set()).get(ev)!).add(fn),
    off: (ev: string, fn: () => void) => void handlers.get(ev)?.delete(fn),
    queryRenderedFeatures: (_p: [number, number], o: { layers: string[] }) =>
      o.layers.includes('rings-fill') ? [{ properties: { id: 'us7000abcd' } }] : [],
  };
  return {
    map: map as unknown as MapLibreMap,
    layers,
    sources,
    paintCalls,
    handlers,
    /** Simulate setStyle(): every runtime layer and source is dropped, then styledata fires. */
    reloadStyle() {
      styleLoaded = true;
      layers.splice(0, layers.length, { id: 'water', type: 'fill' }, { id: 'place-label', type: 'symbol' });
      sources.clear();
      handlers.get('styledata')?.forEach((fn) => fn());
    },
  };
}

const FC = (ids: string[]): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features: ids.map((id) => ({ type: 'Feature', properties: { id }, geometry: { type: 'Point', coordinates: [0, 0] } })),
});

const spec = (color: string): GeoJsonLayerSpec[] => [
  { id: 'rings-fill', type: 'fill', paint: { 'fill-color': color, 'fill-opacity': 0.2 } },
  { id: 'rings-line', type: 'line', paint: { 'line-color': color } },
];

afterEach(() => {
  cleanup();
  useMapInstanceStore.setState({ map: null, ready: false });
});

describe('useGeoJsonLayers (shared map helper)', () => {
  it('waits for the ready map, then adds source + layers beneath the first symbol layer', () => {
    const f = fakeMap();
    const layers = spec('rgba(1,2,3,1)');
    const { rerender } = renderHook(() => useGeoJsonLayers('rings', FC(['a']), layers));
    expect(f.sources.size).toBe(0);
    act(() => useMapInstanceStore.setState({ map: f.map, ready: true }));
    rerender();
    expect(f.layers.map((l) => l.id)).toEqual(['water', 'rings-fill', 'rings-line', 'place-label']);
    expect(f.layers.find((l) => l.id === 'rings-fill')?.source).toBe('rings');
    expect(f.sources.get('rings')?.data).toEqual(FC(['a']));
  });

  it('pushes new data with setData and re-adds everything after a style reload', () => {
    const f = fakeMap();
    useMapInstanceStore.setState({ map: f.map, ready: true });
    const layers = spec('rgba(1,2,3,1)');
    const { rerender } = renderHook(({ data }) => useGeoJsonLayers('rings', data, layers), { initialProps: { data: FC(['a']) } });
    rerender({ data: FC(['a', 'b']) });
    expect(f.sources.get('rings')?.data).toEqual(FC(['a', 'b']));
    act(() => f.reloadStyle());
    expect(f.layers.map((l) => l.id)).toEqual(['water', 'rings-fill', 'rings-line', 'place-label']);
    // The re-added source carries the latest data, not the first render's.
    expect(f.sources.get('rings')?.data).toEqual(FC(['a', 'b']));
  });

  it('a null feed adds an empty collection and never overwrites with null', () => {
    const f = fakeMap();
    useMapInstanceStore.setState({ map: f.map, ready: true });
    renderHook(() => useGeoJsonLayers('rings', null, spec('x')));
    expect(f.sources.get('rings')?.data).toEqual({ type: 'FeatureCollection', features: [] });
  });

  it('theme recolour repaints in place (setPaintProperty, no remove/re-add)', () => {
    const f = fakeMap();
    useMapInstanceStore.setState({ map: f.map, ready: true });
    const { rerender } = renderHook(({ layers }) => useGeoJsonLayers('rings', FC(['a']), layers), {
      initialProps: { layers: spec('rgba(1,2,3,1)') },
    });
    f.paintCalls.length = 0;
    const before = f.layers.find((l) => l.id === 'rings-fill');
    rerender({ layers: spec('rgba(9,9,9,1)') });
    expect(f.paintCalls).toEqual([
      ['rings-fill', 'fill-color', 'rgba(9,9,9,1)'],
      ['rings-fill', 'fill-opacity', 0.2],
      ['rings-line', 'line-color', 'rgba(9,9,9,1)'],
    ]);
    expect(f.layers.find((l) => l.id === 'rings-fill')).toBe(before);
  });

  it('a style mid-reload (addLayer throws) is swallowed and retried on the next styledata', () => {
    const f = fakeMap();
    const real = f.map.addLayer.bind(f.map);
    let fail = true;
    (f.map as unknown as { addLayer: unknown }).addLayer = (...a: Parameters<MapLibreMap['addLayer']>) => {
      if (fail) throw new Error('Style is not done loading');
      return real(...a);
    };
    useMapInstanceStore.setState({ map: f.map, ready: true });
    renderHook(() => useGeoJsonLayers('rings', FC(['a']), spec('x')));
    expect(f.map.getLayer('rings-fill')).toBeUndefined();
    fail = false;
    act(() => f.handlers.get('styledata')?.forEach((fn) => fn()));
    expect(f.map.getLayer('rings-fill')).toBeDefined();
  });

  it('unmount removes its layers, source and styledata listener', () => {
    const f = fakeMap();
    useMapInstanceStore.setState({ map: f.map, ready: true });
    const { unmount } = renderHook(() => useGeoJsonLayers('rings', FC(['a']), spec('x')));
    unmount();
    expect(f.layers.map((l) => l.id)).toEqual(['water', 'place-label']);
    expect(f.sources.size).toBe(0);
    expect(f.handlers.get('styledata')?.size ?? 0).toBe(0);
  });
});

describe('renderedFeatureId', () => {
  it('returns the topmost id only from layers that exist', () => {
    const f = fakeMap();
    expect(renderedFeatureId(f.map, { x: 1, y: 1 }, ['rings-fill'])).toBeNull();
    useMapInstanceStore.setState({ map: f.map, ready: true });
    renderHook(() => useGeoJsonLayers('rings', FC(['a']), spec('x')));
    expect(renderedFeatureId(f.map, { x: 1, y: 1 }, ['rings-fill', 'missing'])).toBe('us7000abcd');
  });
});
