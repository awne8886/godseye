/**
 * Restyles the OpenFreeMap "dark" vector style (OpenMapTiles schema) into the GODSEYE palette
 * without a server proxy (OpenFreeMap: no key, no limits, commercial OK, attribution required).
 * Also moves every symbol layer to the top so data layers and the terminator can be inserted
 * *under* the labels via `beforeId: firstLabelLayerId(style)`, sets our own attribution on the
 * vector source (never the upstream HTML), drops the `wood-pattern` fill pattern the sprite does
 * not ship, thins place labels at z 3–5 so the globe stays readable and labels in English where
 * OSM has an English name (native script otherwise; visual-qa m18). The TileJSON of the vector
 * source is fetched with the style and inlined (`inlineTileJson`) so a TileJSON failure takes
 * the style's retry-with-backoff path instead of leaving a blank globe (R1-m2).
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

const RGB_LIST = /^\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*$/;
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * The basemap palette for the live theme: accent-derived classes (boundaries, road casings, the
 * place dot, water labels, label text and halo) follow the CSS tokens Style Studio writes
 * (`--gold-rgb`, `--gold-primary`, `--cyan-rgb`, `--text-secondary`, `--bg-void`); land, water and
 * buildings keep the neutral HORUS darks. Malformed or missing values fall back to `base`, so
 * HORUS yields exactly HORUS_BASEMAP.
 */
export function themedBasemap(read: (name: string) => string, base: BasemapPalette = HORUS_BASEMAP): BasemapPalette {
  const rgb = (name: string) => {
    const m = RGB_LIST.exec(read(name) ?? '');
    return m && m.slice(1).every((v) => Number(v) <= 255) ? `${Number(m[1])},${Number(m[2])},${Number(m[3])}` : null;
  };
  const hex = (name: string) => {
    const v = (read(name) ?? '').trim().toLowerCase();
    return HEX.test(v) ? v : null;
  };
  const gold = rgb('--gold-rgb');
  const cyan = rgb('--cyan-rgb');
  return {
    ...base,
    roadCasing: gold ? `rgba(${gold},0.10)` : base.roadCasing,
    motorwayLowZoom: gold ? `rgba(${gold},0.30)` : base.motorwayLowZoom,
    boundaryCountry: gold ? `rgba(${gold},0.45)` : base.boundaryCountry,
    boundaryState: gold ? `rgba(${gold},0.14)` : base.boundaryState,
    labelWater: cyan ? `rgba(${cyan},0.45)` : base.labelWater,
    placeDot: hex('--gold-primary') ?? base.placeDot,
    labelPlace: hex('--text-secondary') ?? base.labelPlace,
    halo: hex('--bg-void') ?? base.halo,
  };
}

/**
 * Paint properties that differ between two transformed styles (same layer ids), for recolouring
 * a live map in place with setPaintProperty instead of setStyle.
 */
export function paintDiff(prev: StyleSpecification, next: StyleSpecification): { id: string; prop: string; value: unknown }[] {
  const before = new Map(prev.layers.map((l) => [l.id, (l as { paint?: Paint }).paint ?? {}]));
  const out: { id: string; prop: string; value: unknown }[] = [];
  for (const l of next.layers) {
    const old = before.get(l.id);
    if (!old) continue;
    for (const [prop, value] of Object.entries((l as { paint?: Paint }).paint ?? {})) {
      if (JSON.stringify(old[prop]) !== JSON.stringify(value)) out.push({ id: l.id, prop, value });
    }
  }
  return out;
}

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

/** One label per place: English where OSM has it (`name:en`, the OMT `name_en`), else the local name. */
export const ENGLISH_NAME: unknown[] = ['coalesce', ['get', 'name:en'], ['get', 'name_en'], ['get', 'name']];

/** Replace name-based `text-field`s (the upstream bilingual latin/nonlatin stack); refs stay. */
function englishLabels(l: LayerSpecification): LayerSpecification {
  if (l.type !== 'symbol') return l;
  const layout: Paint = { ...((l as { layout?: Paint }).layout ?? {}) };
  const tf = layout['text-field'];
  if (tf === undefined || !/"name(:|_|")|\{name/.test(JSON.stringify(tf))) return l;
  layout['text-field'] = ENGLISH_NAME;
  return { ...l, layout } as LayerSpecification;
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
  const layers = style.layers.map((l) => englishLabels(thinLabels(dropMissingPatterns(recolor(l, palette)))));
  const base = layers.filter((l) => l.type !== 'symbol');
  const labels = layers.filter((l) => l.type === 'symbol');
  const sources = { ...style.sources };
  const omt = sources.openmaptiles;
  if (omt) sources.openmaptiles = { ...omt, attribution: BASEMAP_ATTRIBUTION } as typeof omt;
  return { ...style, sources, layers: [...base, ...labels] };
}

/** Vector source of the OpenFreeMap style whose TileJSON is inlined. */
export const BASEMAP_SOURCE_ID = 'openmaptiles';

export interface TileJson {
  tiles: string[];
  minzoom?: number;
  maxzoom?: number;
  bounds?: [number, number, number, number];
}

/** TileJSON URL of the basemap's vector source, if it is referenced by URL. */
export function tileJsonUrl(style: StyleSpecification, sourceId = BASEMAP_SOURCE_ID): string | null {
  const src = style.sources[sourceId] as { url?: unknown } | undefined;
  return typeof src?.url === 'string' ? src.url : null;
}

/** Validate a fetched TileJSON: https tile templates on the same host as the TileJSON only. */
export function parseTileJson(raw: unknown, from: string): TileJson {
  const t = raw as Partial<TileJson> | null;
  const host = new URL(from).host;
  const tiles = Array.isArray(t?.tiles) ? t.tiles.filter((u): u is string => typeof u === 'string' && u.startsWith('https://') && new URL(u.replace(/[{}]/g, '')).host === host) : [];
  if (!tiles.length) throw new Error('basemap TileJSON has no usable tiles');
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const b = t?.bounds;
  const bounds = Array.isArray(b) && b.length === 4 && b.every((v) => typeof v === 'number' && Number.isFinite(v)) ? (b as TileJson['bounds']) : undefined;
  return { tiles, minzoom: num(t?.minzoom), maxzoom: num(t?.maxzoom), bounds };
}

/** Replace the source's `url` with the TileJSON's tiles/zoom range/bounds (attribution kept ours). */
export function inlineTileJson(style: StyleSpecification, tj: TileJson, sourceId = BASEMAP_SOURCE_ID): StyleSpecification {
  const src = style.sources[sourceId];
  if (!src) return style;
  const { url: _url, ...rest } = src as { url?: string } & Record<string, unknown>;
  const next: Record<string, unknown> = { ...rest, tiles: tj.tiles };
  if (tj.minzoom !== undefined) next.minzoom = tj.minzoom;
  if (tj.maxzoom !== undefined) next.maxzoom = tj.maxzoom;
  if (tj.bounds) next.bounds = tj.bounds;
  return { ...style, sources: { ...style.sources, [sourceId]: next as unknown as (typeof style.sources)[string] } };
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
