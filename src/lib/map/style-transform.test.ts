import type { StyleSpecification } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';
import { HORUS_BASEMAP, firstLabelLayerId, transformStyle } from './style-transform';

// Representative subset of https://tiles.openfreemap.org/styles/dark (layer order preserved).
const style = {
  version: 8,
  sources: { openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': 'rgb(12,12,12)' } },
    { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water', paint: { 'fill-color': 'rgb(27,27,29)' } },
    { id: 'water_name', type: 'symbol', source: 'openmaptiles', 'source-layer': 'water_name', layout: {}, paint: { 'text-color': '#000' } },
    { id: 'building', type: 'fill', source: 'openmaptiles', 'source-layer': 'building', paint: { 'fill-color': 'rgb(10,10,10)' } },
    { id: 'highway_motorway_inner', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', paint: { 'line-color': '#000' } },
    { id: 'highway_major_casing', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', paint: { 'line-color': '#000' } },
    { id: 'railway_dashline', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', paint: { 'line-color': '#000' } },
    { id: 'boundary_country_z0-4', type: 'line', source: 'openmaptiles', 'source-layer': 'boundary', paint: { 'line-color': '#333' } },
    { id: 'boundary_state', type: 'line', source: 'openmaptiles', 'source-layer': 'boundary', paint: { 'line-color': '#333' } },
    { id: 'place_city', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place', layout: {}, paint: { 'text-color': '#666' } },
    { id: 'place_country_major', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place', layout: {}, paint: { 'text-color': '#666' } },
  ],
} as unknown as StyleSpecification;

const paint = (s: StyleSpecification, id: string) => (s.layers.find((l) => l.id === id) as { paint: Record<string, unknown> }).paint;

describe('basemap style transform', () => {
  const out = transformStyle(style);

  it('recolours land, water, buildings and boundaries into the HORUS palette', () => {
    expect(paint(out, 'background')['background-color']).toBe(HORUS_BASEMAP.land);
    expect(paint(out, 'water')['fill-color']).toBe(HORUS_BASEMAP.water);
    expect(paint(out, 'building')['fill-color']).toBe(HORUS_BASEMAP.building);
    expect(paint(out, 'boundary_country_z0-4')['line-color']).toBe(HORUS_BASEMAP.boundaryCountry);
    expect(paint(out, 'boundary_state')['line-color']).toBe(HORUS_BASEMAP.boundaryState);
    expect(paint(out, 'highway_major_casing')['line-color']).toBe(HORUS_BASEMAP.roadCasing);
    expect(paint(out, 'railway_dashline')['line-color']).toBe(HORUS_BASEMAP.land);
    expect(Array.isArray(paint(out, 'highway_motorway_inner')['line-color'])).toBe(true);
  });

  it('gives labels a dark halo and moves every symbol layer above data layers', () => {
    expect(paint(out, 'place_country_major')['text-color']).toBe(HORUS_BASEMAP.labelCountry);
    expect(paint(out, 'place_city')['text-halo-color']).toBe(HORUS_BASEMAP.halo);
    const types = out.layers.map((l) => l.type);
    expect(types.indexOf('symbol')).toBe(types.length - 3);
    expect(firstLabelLayerId(out)).toBe('water_name');
    expect(out.layers).toHaveLength(style.layers.length);
  });

  it('does not mutate the input', () => {
    expect(paint(style, 'water')['fill-color']).toBe('rgb(27,27,29)');
  });
});
