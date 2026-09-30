/**
 * Restyles the OpenFreeMap "dark" vector style (OpenMapTiles schema) into the GODSEYE palette
 * without a server proxy (OpenFreeMap: no key, no limits, commercial OK, attribution required).
 * Also moves every symbol layer to the top so data layers and the terminator can be inserted
 * *under* the labels via `beforeId: firstLabelLayerId(style)`.
 * Owner: map-engine. Pure and unit-tested.
 */
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';

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
      else if (sl === 'water_name') paint['text-color'] = p.labelWater;
      else if (sl === 'transportation_name' || sl === 'transportation') paint['text-color'] = p.labelRoad;
      else paint['text-color'] = p.labelPlace;
      paint['text-halo-color'] = p.halo;
      paint['text-halo-width'] = 1.2;
      break;
    }
    default:
      break;
  }
  return { ...l, paint } as LayerSpecification;
}

/** Recolour every layer and move symbol layers to the top (stable order within each group). */
export function transformStyle(style: StyleSpecification, palette: BasemapPalette = HORUS_BASEMAP): StyleSpecification {
  const layers = style.layers.map((l) => recolor(l, palette));
  const base = layers.filter((l) => l.type !== 'symbol');
  const labels = layers.filter((l) => l.type === 'symbol');
  return { ...style, layers: [...base, ...labels] };
}

/** Id of the first label layer: data layers are inserted before it so labels stay on top. */
export function firstLabelLayerId(style: Pick<StyleSpecification, 'layers'>): string | undefined {
  return style.layers.find((l) => l.type === 'symbol')?.id;
}
