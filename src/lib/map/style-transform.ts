/**
 * Restyles the OpenFreeMap "dark" vector style (OpenMapTiles schema) into the GODSEYE palette
 * without a server proxy (OpenFreeMap: no key, no limits, commercial OK, attribution required).
 * Also moves every symbol layer to the top so data layers and the terminator can be inserted
 * *under* the labels via `beforeId: firstLabelLayerId(style)`, sets our own attribution on the
 * vector source (never the upstream HTML), drops the `wood-pattern` fill pattern the sprite does
 * not ship, and thins place labels at z 3–5 so the globe stays readable.
 * Owner: map-engine. Pure and unit-tested.
 */
import type { FillExtrusionLayerSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl';

export const BASEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';
export const BASEMAP_ATTRIBUTION = '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

export interface BasemapPalette {
  land: string;
  water: string;
  landcover: string;
  park: string;
  building: string;
  roadMinor: string;
  roadMajor: string;
  roadCasing: string;
  motorwayLowZoom: string;
  rail: string;
  boundaryCountry: string;
  boundaryState: string;
  labelPlace: string;
  labelCountry: string;
  labelWater: string;
  labelRoad: string;
  halo: string;
  /** fill-extrusion height ramp (0 m, 20 m, 60 m, 150 m, 300 m) for 3D buildings. */
  buildingRamp: readonly [string, string, string, string, string];
  /** Gold SDF dot used for the `circle-11` place marker (the sprite lacks it). */
  placeDot: string;
}

export const HORUS_BASEMAP: BasemapPalette = {
  land: '#131722',
  water: '#05070d',
  landcover: '#161b27',
  park: '#141d22',
  building: '#1b1f2c',
  roadMinor: '#1b1f2b',
  roadMajor: '#232838',
  roadCasing: 'rgba(212,175,55,0.10)',
  motorwayLowZoom: 'rgba(212,175,55,0.30)',
  rail: '#1f2330',
  boundaryCountry: 'rgba(212,175,55,0.45)',
  boundaryState: 'rgba(212,175,55,0.14)',
  labelPlace: '#9b978e',
  labelCountry: '#c9b77e',
  labelWater: 'rgba(0,229,255,0.45)',
  labelRoad: '#6f6c64',
  halo: '#04040a',
  buildingRamp: ['#161a26', '#1d2233', '#2a2f45', '#4a3f2a', '#8b7325'],
  placeDot: '#d4af37',
};

/** Style layer id before which basemap imagery (Esri, GIBS) is inserted: boundaries + labels stay on top. */
export const IMAGERY_BEFORE_ID = 'boundary_state';

/**
 * Minimum zoom per place layer (label density at z 3–5): only capitals/large cities and
 * countries show on the whole-globe view; states, towns and villages come in as you zoom.
 */
export const PLACE_MIN_ZOOM: Record<string, number> = {
  place_state: 5,
  place_city: 4,
  place_town: 6,
  place_village: 8,
  place_suburb: 10,
  place_other: 11,
};

type Paint = Record<string, unknown>;

function sourceLayer(l: LayerSpecification): string {
  return 'source-layer' in l && typeof l['source-layer'] === 'string' ? l['source-layer'] : '';
}

function recolor(l: LayerSpecification, p: BasemapPalette): LayerSpecification {
  const id = l.id;
  const sl = sourceLayer(l);
  const paint: Paint = { ...((l as { paint?: Paint }).paint ?? {}) };
  switch (l.type) {
    case 'background':
      paint['background-color'] = p.land;
      break;
    case 'fill':
      if (sl === 'water') paint['fill-color'] = p.water;
      else if (sl === 'building') paint['fill-color'] = p.building;
      else if (id.includes('park') || id.includes('wood')) paint['fill-color'] = p.park;
      else if (sl === 'landcover' || sl === 'landuse') paint['fill-color'] = p.landcover;
      else if (sl === 'aeroway' || sl === 'transportation') paint['fill-color'] = p.roadMinor;
      else paint['fill-color'] = p.landcover;
      delete paint['fill-outline-color'];
      break;
    case 'line':
      if (sl === 'waterway') paint['line-color'] = p.water;
      else if (sl === 'boundary') paint['line-color'] = id.includes('country') ? p.boundaryCountry : p.boundaryState;
      else if (id.includes('dashline')) paint['line-color'] = p.land;
      else if (id.includes('rail')) paint['line-color'] = p.rail;
      else if (id.includes('casing')) paint['line-color'] = p.roadCasing;
      else if (id.includes('motorway_inner')) paint['line-color'] = ['interpolate', ['linear'], ['zoom'], 5.8, p.motorwayLowZoom, 6, p.roadMajor];
      else if (id.includes('major') || id.includes('motorway') || id.includes('runway')) paint['line-color'] = p.roadMajor;
      else paint['line-color'] = p.roadMinor;
      break;
    case 'symbol': {
      if (id.startsWith('place_country')) paint['text-color'] = p.labelCountry;
      else if (id === 'place_state') paint['text-color'] = p.labelRoad;
      else if (sl === 'water_name') paint['text-color'] = p.labelWater;
      else if (sl === 'transportation_name' || sl === 'transportation') paint['text-color'] = p.labelRoad;
      else paint['text-color'] = p.labelPlace;
      paint['text-halo-color'] = p.halo;
      paint['text-halo-width'] = 1.2;
      // `circle-11` is resolved as an SDF dot (style-images.ts), tinted here.
      if ('icon-image' in ((l as { layout?: Paint }).layout ?? {})) paint['icon-color'] = p.placeDot;
      break;
    }
    default:
      break;
  }
  return { ...l, paint } as LayerSpecification;
}

/** Drop paint properties that reference sprite images the OpenFreeMap sprite does not ship. */
function dropMissingPatterns(l: LayerSpecification): LayerSpecification {
  if (l.type !== 'fill') return l;
  const paint = { ...((l as { paint?: Paint }).paint ?? {}) };
  if (!('fill-pattern' in paint)) return l;
  delete paint['fill-pattern'];
  return { ...l, paint } as LayerSpecification;
}

/** Label density at z 3–5: raise place minzooms, prefer important places, pad labels at low zoom. */
function thinLabels(l: LayerSpecification): LayerSpecification {
  if (l.type !== 'symbol' || sourceLayer(l) !== 'place') return l;
  const layout: Paint = { ...((l as { layout?: Paint }).layout ?? {}) };
  layout['symbol-sort-key'] = ['coalesce', ['get', 'rank'], 99];
  layout['text-padding'] = ['interpolate', ['linear'], ['zoom'], 3, 8, 6, 2];
  const minzoom = PLACE_MIN_ZOOM[l.id];
  const out = { ...l, layout } as LayerSpecification & { minzoom?: number };
  if (minzoom !== undefined) out.minzoom = Math.max(minzoom, out.minzoom ?? 0);
  return out;
}

/**
 * Recolour every layer, fix sprite gaps, thin labels, set our attribution and move symbol layers
 * to the top (stable order within each group).
 */
export function transformStyle(style: StyleSpecification, palette: BasemapPalette = HORUS_BASEMAP): StyleSpecification {
  const layers = style.layers.map((l) => thinLabels(dropMissingPatterns(recolor(l, palette))));
  const base = layers.filter((l) => l.type !== 'symbol');
  const labels = layers.filter((l) => l.type === 'symbol');
  const sources = { ...style.sources };
  const omt = sources.openmaptiles;
  if (omt) sources.openmaptiles = { ...omt, attribution: BASEMAP_ATTRIBUTION } as typeof omt;
  return { ...style, sources, layers: [...base, ...labels] };
}

/**
 * The 3D building layer (registry `terrain_3d`): fill-extrusion on the basemap's own `building`
 * source-layer from z 14.5, skipping parts OpenMapTiles marks `hide_3d`, height/base growing in
 * from z 14.5 → 15.5 and coloured by height from the palette.
 */
export const BUILDINGS_3D_LAYER_ID = 'godseye-3d-buildings';
export const BUILDINGS_MIN_ZOOM = 14.5;

export function buildingExtrusionLayer(palette: BasemapPalette = HORUS_BASEMAP): FillExtrusionLayerSpecification {
  const [c0, c1, c2, c3, c4] = palette.buildingRamp;
  return {
    id: BUILDINGS_3D_LAYER_ID,
    type: 'fill-extrusion',
    source: 'openmaptiles',
    'source-layer': 'building',
    minzoom: BUILDINGS_MIN_ZOOM,
    filter: ['!=', ['get', 'hide_3d'], true],
    layout: { visibility: 'none' },
    paint: {
      'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 0], 0, c0, 20, c1, 60, c2, 150, c3, 300, c4],
      'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], BUILDINGS_MIN_ZOOM, 0, 15.5, ['coalesce', ['get', 'render_height'], 0]],
      'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], BUILDINGS_MIN_ZOOM, 0, 15.5, ['coalesce', ['get', 'render_min_height'], 0]],
      'fill-extrusion-opacity': 0.85,
      'fill-extrusion-vertical-gradient': true,
    },
  };
}

/** Id of the first label layer: data layers are inserted before it so labels stay on top. */
export function firstLabelLayerId(style: Pick<StyleSpecification, 'layers'>): string | undefined {
  return style.layers.find((l) => l.type === 'symbol')?.id;
}
