// @vitest-environment jsdom
// L126: drawn shapes, the planned route and imported ArcGIS features are clickable and open a
// `drawn_shape` card — but never while a DRAW tool is armed. Fixtures: a recorded OSRM Berlin
// route and a recorded ArcGIS FeatureServer f=geojson query (both captured from the real upstreams).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LayersList } from '@deck.gl/core';
import type { Selection } from '@/lib/layer-host';
import { useSelectionStore } from '@/lib/layer-host';
import { candidatesFromDeck, type DeckPickInfo } from '@/lib/map/picking';
import type { DirectionsResponse } from '@/lib/types';
import { normalizeOsrm } from '../recon/server/directions';
import { sanitizeFeatures } from '../recon/server/arcgis';
import { useOverlayStore, type ArcgisLayer } from '../recon/overlay-store';
import { MAX_ATTRS, MAX_STR, arcgisSelection, drawnShapeSelection, routeSelection, smallAttributes, type PickState } from './pick';
import { DrawnShapeCard } from './DrawnShapeCard';
import type { DrawFeature } from './geometry';

const published: { layers: LayersList | null } = { layers: null };
vi.mock('@/lib/layer-host', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useDeckLayers: (_k: string, layers: LayersList | null) => {
    published.layers = layers;
  },
  useMapInstance: () => null,
}));

const fx = (f: string) => JSON.parse(readFileSync(path.join(__dirname, '../recon/__fixtures__', f), 'utf8')) as unknown;

const routes = normalizeOsrm(fx('osrm-driving-berlin.json') as Parameters<typeof normalizeOsrm>[0]);
const result: DirectionsResponse = {
  engine: 'osrm',
  mode: 'drive',
  routes,
  elevation: null,
  ascentM: null,
  descentM: null,
  attribution: '© OpenStreetMap contributors · OSRM',
  providers: { osrm: { ok: true, count: routes.length, ms: 120, age_s: 0 } },
  timestamp: '2026-10-02T10:00:00.000Z',
};
const { fc } = sanitizeFeatures(fx('arcgis-featureserver-query.json'));
const arcLayer: ArcgisLayer = {
  id: 'arcgis-x-1',
  title: 'USGS earthquakes',
  source: 'https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/USGS_Seismic_Data_v1/FeatureServer/0',
  fc,
  truncated: true,
  visible: true,
  importedAt: '2026-10-02T09:59:00.000Z',
};
// Berlin triangle (lng, lat).
const poly: DrawFeature = {
  type: 'Feature',
  geometry: { type: 'Polygon', coordinates: [[[13.3, 52.5], [13.5, 52.5], [13.4, 52.6], [13.3, 52.5]]] },
  properties: { id: 'poly-1', shape: 'polygon', name: 'Polygon 1', aoi: true },
};

const base = (over: Partial<PickState> = {}): PickState => ({ drawMode: null, features: [poly], route: { result, active: 0, stops: [] }, arcgis: [arcLayer], ...over });
const click: [number, number] = [13.4, 52.55];

describe('pick resolvers (pure)', () => {
  it('a drawn polygon → drawn_shape with measurements, local source, no observation time', () => {
    const s = drawnShapeSelection({ object: poly, index: 0, coordinate: click }, base());
    expect(s).toMatchObject({ kind: 'drawn_shape', id: 'poly-1', layer: null, source: 'local', observedAt: null, lngLat: click });
    expect(s?.data).toMatchObject({ type: 'drawn', name: 'Polygon 1', shape: 'polygon', aoi: true, vertices: 3, lengthM: null, radiusM: null });
    expect(s?.data.areaM2 as number).toBeGreaterThan(1e7);
    expect(s?.data.perimeterM as number).toBeGreaterThan(1e4);
  });

  it('returns null while a DRAW tool is armed, and for a shape no longer in the store', () => {
    expect(drawnShapeSelection({ object: poly, coordinate: click }, base({ drawMode: 'line' }))).toBeNull();
    expect(drawnShapeSelection({ object: poly, coordinate: click }, base({ features: [] }))).toBeNull();
    expect(routeSelection({ object: { i: 0 }, coordinate: click }, base({ drawMode: 'polygon' }))).toBeNull();
    expect(arcgisSelection(arcLayer, { object: fc.features[0], index: 0, coordinate: click }, { drawMode: 'point' })).toBeNull();
  });

  it('the route → id "route", directions:<engine> source, the recorded distance and time', () => {
    const s = routeSelection({ object: { i: 0 }, coordinate: click }, base());
    expect(s).toMatchObject({ kind: 'drawn_shape', id: 'route', layer: null, source: 'directions:osrm', observedAt: null });
    expect(s?.data).toMatchObject({ type: 'route', active: true, distanceM: routes[0]!.distanceM, durationS: routes[0]!.durationS, computedAt: result.timestamp });
    expect(routeSelection({ object: { i: 99 }, coordinate: click }, base())).toBeNull();
    expect(routeSelection({ object: { i: 0 }, coordinate: click }, base({ route: null }))).toBeNull();
  });

  it('an ArcGIS feature → arcgis:<layerId>:<index>, arcgis:<host> source, capped primitive attributes', () => {
    const s = arcgisSelection(arcLayer, { object: fc.features[2], index: 2, coordinate: click }, { drawMode: null });
    expect(s).toMatchObject({ kind: 'drawn_shape', id: 'arcgis:arcgis-x-1:2', layer: null, source: 'arcgis:services9.arcgis.com', observedAt: null });
    const attrs = s?.data.attributes as Record<string, unknown>;
    expect(Object.keys(attrs).length).toBeLessThanOrEqual(MAX_ATTRS);
    expect(attrs.place).toBe((fc.features[2]!.properties as Record<string, unknown>).place);
    expect(s?.data.geometryType).toBe('Point');
  });

  it('smallAttributes drops nested values, caps count and long strings', () => {
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i]));
    const r = smallAttributes({ nested: { a: 1 }, long: 'x'.repeat(MAX_STR + 50), ...many });
    expect(Object.keys(r.attributes)).toHaveLength(MAX_ATTRS);
    expect((r.attributes.long as string).length).toBe(MAX_STR + 1);
    expect(r.omitted).toBe(1 + 30 - (MAX_ATTRS - 1));
  });
});

describe('ReconOverlays wiring', () => {
  const reset = () => {
    useOverlayStore.setState({ drawMode: null, sketch: [], features: [], route: null, arcgis: [] });
    useSelectionStore.getState().clear();
  };
  beforeEach(reset);
  afterEach(() => {
    cleanup();
    reset();
    published.layers = null;
  });

  const layerProps = (id: string) => (published.layers as { id: string; props: Record<string, unknown> }[]).find((l) => l.id === id);
  const pick = (id: string, object: unknown, index = 0): Selection | null => {
    const l = layerProps(id)!;
    const info: DeckPickInfo = { object, index, coordinate: click, layer: { id: l.id, props: l.props } };
    return candidatesFromDeck([info])[0]?.selection ?? null;
  };

  it('publishes pickable draw/route/ArcGIS layers whose clicks route to drawn_shape selections', async () => {
    const { default: ReconOverlays } = await import('../recon/ReconOverlays');
    useOverlayStore.setState({ features: [poly], route: { result, active: 0, stops: [[13.3, 52.5]] }, arcgis: [arcLayer] });
    render(<ReconOverlays />);
    for (const id of ['recon-draw', 'recon-route', 'recon-route-casing', 'recon-arcgis-arcgis-x-1']) expect(layerProps(id)?.props.pickable, id).toBe(true);
    expect(pick('recon-draw', poly)?.id).toBe('poly-1');
    expect(pick('recon-route', { path: [], i: 0 })?.id).toBe('route');
    expect(pick('recon-arcgis-arcgis-x-1', fc.features[1], 1)?.id).toBe('arcgis:arcgis-x-1:1');

    // Armed tool: the same clicks select nothing (they add vertices instead).
    act(() => useOverlayStore.setState({ drawMode: 'polygon' }));
    expect(pick('recon-draw', poly)).toBeNull();
    expect(pick('recon-route', { path: [], i: 0 })).toBeNull();
    expect(pick('recon-arcgis-arcgis-x-1', fc.features[1], 1)).toBeNull();
  });
});

describe('DrawnShapeCard', () => {
  afterEach(() => {
    cleanup();
    useOverlayStore.setState({ features: [], route: null, arcgis: [] });
  });

  it('shows a drawn shape in the visitor units and removes it', () => {
    useOverlayStore.setState({ features: [poly] });
    const sel = drawnShapeSelection({ object: poly, coordinate: click }, base())!;
    useSelectionStore.getState().select(sel);
    render(<DrawnShapeCard selection={sel} />);
    expect(screen.getByTestId('drawn-shape-card').textContent).toMatch(/POLYGON/);
    expect(screen.getByTestId('drawn-shape-card').textContent).toMatch(/NM²/);
    fireEvent.click(screen.getByRole('button', { name: /remove shape/i }));
    expect(useOverlayStore.getState().features).toHaveLength(0);
    expect(useSelectionStore.getState().selection).toBeNull();
  });

  it('shows the route and switches to an alternate', () => {
    const two: DirectionsResponse = { ...result, routes: [routes[0]!, routes[0]!] };
    useOverlayStore.setState({ route: { result: two, active: 0, stops: [] } });
    const sel = routeSelection({ object: { i: 1 }, coordinate: click }, base({ route: { result: two, active: 0, stops: [] } }))!;
    render(<DrawnShapeCard selection={sel} />);
    expect(screen.getByTestId('drawn-route-card').textContent).toMatch(/OSRM/);
    fireEvent.click(screen.getByRole('button', { name: /use this route/i }));
    expect(useOverlayStore.getState().route?.active).toBe(1);
  });

  it('renders ArcGIS attributes as text, never as HTML', () => {
    const evil: GeoJSON.Feature = { type: 'Feature', geometry: { type: 'Point', coordinates: click }, properties: { name: '<img src=x onerror=alert(1)>' } };
    const sel = arcgisSelection({ ...arcLayer, fc: { type: 'FeatureCollection', features: [evil] } }, { object: evil, index: 0, coordinate: click }, { drawMode: null })!;
    const { container } = render(<DrawnShapeCard selection={sel} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('drawn-arcgis-card').textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
