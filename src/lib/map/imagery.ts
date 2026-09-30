/**
 * Browser-fetched imagery and elevation sources (hosts listed in src/config/hosts.ts; never
 * proxied or cached server-side). Every source carries its own attribution, shown by the
 * always-visible attribution control while the source is on screen. All of these are REFERENCE
 * layers: they are dated imagery or static models, never live observations.
 * Owner: map-engine. Pure and unit-tested.
 */

// ── Esri World Imagery (Satellite View) ──────────────────────────────────────────
export const ESRI_SOURCE_ID = 'godseye-esri-imagery';
export const ESRI_LAYER_ID = 'godseye-esri-imagery';
export const ESRI_TILES = ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'];
export const ESRI_MAX_ZOOM = 19;
/** Verbatim `copyrightText` of the World_Imagery MapServer (Vantor is Maxar's new name). */
export const ESRI_ATTRIBUTION = 'Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community';

// ── NASA GIBS ────────────────────────────────────────────────────────────────────
const GIBS_WMTS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
export const GIBS_ACK = 'Imagery: NASA GIBS, part of NASA ESDIS';

export const GIBS_TRUECOLOR_SOURCE_ID = 'godseye-gibs-truecolor';
export const GIBS_TRUECOLOR_LAYER_ID = 'godseye-gibs-truecolor';
export const GIBS_TRUECOLOR_MAX_ZOOM = 9;

/**
 * The GIBS daily mosaic to show: the previous UTC day. Today's mosaic is still being filled in
 * swath by swath, so it would present gaps as if they were observations.
 */
export function gibsTrueColorDate(now: Date | number): string {
  const ms = typeof now === 'number' ? now : now.getTime();
  const d = new Date(ms - 86_400_000);
  return d.toISOString().slice(0, 10);
}

export function gibsTrueColorTiles(date: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`GIBS date must be YYYY-MM-DD: ${date}`);
  return [`${GIBS_WMTS}/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`];
}

/** Static so a date roll-over only swaps tiles (the dated chip shows the day). */
export const GIBS_TRUECOLOR_ATTRIBUTION = `VIIRS SNPP true colour (previous UTC day) · ${GIBS_ACK}`;

export function gibsTrueColorLabel(date: string): string {
  return `VIIRS TRUE COLOUR ${date} · REFERENCE`;
}

/** VIIRS Black Marble 2016 composite: the only Black Marble date GIBS serves in EPSG:3857. */
export const BLACK_MARBLE_DATE = '2016-01-01';
export const BLACK_MARBLE_MAX_ZOOM = 8;
export const BLACK_MARBLE_LABEL = 'BLACK MARBLE 2016 · REFERENCE';
export const BLACK_MARBLE_ATTRIBUTION = `Night lights: VIIRS Black Marble 2016 · ${GIBS_ACK}`;

export function blackMarbleUrl(z: number, x: number, y: number): string {
  return `${GIBS_WMTS}/VIIRS_Black_Marble/default/${BLACK_MARBLE_DATE}/GoogleMapsCompatible_Level8/${z}/${y}/${x}.png`;
}

// ── AWS Terrain Tiles (Terrarium) ────────────────────────────────────────────────
export const TERRAIN_SOURCE_ID = 'godseye-terrain-dem';
export const TERRARIUM_TILES = ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'];
/** Downloads stop at z 12; MapLibre over-zooms the DEM beyond that. */
export const TERRARIUM_MAX_ZOOM = 12;
export const TERRARIUM_ATTRIBUTION =
  '<a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">Terrain: Mapzen / Tilezen Joerd</a>';
