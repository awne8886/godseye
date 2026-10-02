import type { StyleSpecification } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/openfreemap-dark.2026-09-30.json';
import planet from './__fixtures__/openfreemap-planet-tilejson.2026-09-30.json';
import {
  BASEMAP_ATTRIBUTION,
  ENGLISH_NAME,
  inlineTileJson,
  parseTileJson,
  tileJsonUrl,
  BUILDINGS_3D_LAYER_ID,
  BUILDINGS_MIN_ZOOM,
  HORUS_BASEMAP,
  IMAGERY_BEFORE_ID,
  PLACE_MIN_ZOOM,
  buildingExtrusionLayer,
  firstLabelLayerId,
  transformStyle,
} from './style-transform';

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

// Full style captured from https://tiles.openfreemap.org/styles/dark on 2026-09-30 (see its metadata).
describe('basemap style transform on the captured OpenFreeMap style', () => {
  const raw = fixture as unknown as StyleSpecification;
  const out = transformStyle(raw);
  const layer = (id: string) =>
    out.layers.find((l) => l.id === id) as unknown as { paint?: Record<string, unknown>; layout?: Record<string, unknown>; minzoom?: number };

  it('drops the wood fill-pattern the sprite does not ship (no missing-image warning)', () => {
    expect((raw.layers.find((l) => l.id === 'landcover_wood') as { paint: Record<string, unknown> }).paint['fill-pattern']).toBe('wood-pattern');
    expect(layer('landcover_wood').paint).not.toHaveProperty('fill-pattern');
    expect(out.layers.some((l) => 'fill-pattern' in ((l as { paint?: object }).paint ?? {}))).toBe(false);
  });

  it('sets our own attribution on the vector source (never the upstream HTML)', () => {
    expect((out.sources.openmaptiles as { attribution?: string }).attribution).toBe(BASEMAP_ATTRIBUTION);
    expect((raw.sources.openmaptiles as { attribution?: string }).attribution).toBeUndefined();
    expect(BASEMAP_ATTRIBUTION).toContain('OpenStreetMap');
  });

  it('tints circle-11 place dots (resolved as an SDF image) with the palette', () => {
    for (const id of ['place_town', 'place_city', 'place_city_large']) expect(layer(id).paint?.['icon-color']).toBe(HORUS_BASEMAP.placeDot);
  });

  it('thins place labels at z 3-5', () => {
    for (const [id, z] of Object.entries(PLACE_MIN_ZOOM)) expect(layer(id).minzoom).toBe(z);
    expect(layer('place_city_large').minzoom).toBeUndefined(); // large cities stay on the globe view
    expect(layer('place_country_major').minzoom).toBeUndefined();
    expect(layer('place_city').layout?.['symbol-sort-key']).toEqual(['coalesce', ['get', 'rank'], 99]);
  });

  it('keeps every layer, labels last, with the imagery anchor below the labels', () => {
    expect(out.layers).toHaveLength(raw.layers.length);
    const firstSymbol = out.layers.findIndex((l) => l.type === 'symbol');
    expect(out.layers.slice(firstSymbol).every((l) => l.type === 'symbol')).toBe(true);
    const anchor = out.layers.findIndex((l) => l.id === IMAGERY_BEFORE_ID);
    expect(anchor).toBeGreaterThan(0);
    expect(anchor).toBeLessThan(firstSymbol);
  });
});

describe('3D buildings layer', () => {
  const l = buildingExtrusionLayer();
  it('extrudes the basemap building source-layer from z 14.5, skipping hide_3d', () => {
    expect(l).toMatchObject({ id: BUILDINGS_3D_LAYER_ID, type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', minzoom: BUILDINGS_MIN_ZOOM });
    expect(l.filter).toEqual(['!=', ['get', 'hide_3d'], true]);
    expect(l.layout?.visibility).toBe('none');
  });
  it('ramps colour by height from the palette and grows in from z 14.5', () => {
    const colour = l.paint?.['fill-extrusion-color'] as unknown[];
    for (const c of HORUS_BASEMAP.buildingRamp) expect(colour).toContain(c);
    expect(l.paint?.['fill-extrusion-height']).toEqual(['interpolate', ['linear'], ['zoom'], 14.5, 0, 15.5, ['coalesce', ['get', 'render_height'], 0]]);
  });
});

describe('English labels (visual-qa m18)', () => {
  const out = transformStyle(fixture as unknown as StyleSpecification);
  const tf = (id: string) => (out.layers.find((l) => l.id === id) as { layout?: Record<string, unknown> } | undefined)?.layout?.['text-field'];

  it('replaces the bilingual latin/nonlatin stack with name:en → name_en → name', () => {
    for (const id of ['place_country_major', 'place_city', 'place_state', 'water_name']) {
      if (tf(id) !== undefined) expect(tf(id)).toEqual(ENGLISH_NAME);
    }
    expect(JSON.stringify(out.layers)).not.toContain('name:nonlatin');
  });

  it('leaves non-name labels (motorway refs) alone', () => {
    const ref = tf('highway_name_motorway');
    if (ref !== undefined) expect(JSON.stringify(ref)).toContain('ref');
  });
});

describe('TileJSON inlining (R1-m2)', () => {
  const raw = fixture as unknown as StyleSpecification;
  const url = tileJsonUrl(raw);

  it('finds the vector TileJSON URL and inlines tiles, zoom range and bounds, keeping our attribution', () => {
    expect(url).toBe('https://tiles.openfreemap.org/planet');
    const tj = parseTileJson(planet, url!);
    expect(tj.tiles[0]).toMatch(/^https:\/\/tiles\.openfreemap\.org\/planet\/.+\/\{z\}\/\{x\}\/\{y\}\.pbf$/);
    expect(tj.maxzoom).toBe(14);
    const out = transformStyle(inlineTileJson(raw, tj));
    const src = out.sources.openmaptiles as Record<string, unknown>;
    expect(src.url).toBeUndefined();
    expect(src.tiles).toEqual(tj.tiles);
    expect(src.maxzoom).toBe(14);
    expect(src.attribution).toBe(BASEMAP_ATTRIBUTION);
  });

  it('rejects a TileJSON without usable same-host https tiles', () => {
    expect(() => parseTileJson({ tiles: [] }, 'https://tiles.openfreemap.org/planet')).toThrow();
    expect(() => parseTileJson({ tiles: ['https://evil.example/{z}/{x}/{y}.pbf'] }, 'https://tiles.openfreemap.org/planet')).toThrow();
    expect(() => parseTileJson(null, 'https://tiles.openfreemap.org/planet')).toThrow();
  });
});
