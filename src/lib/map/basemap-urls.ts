/**
 * OpenFreeMap endpoints of the basemap (keyless, CORS `*`). Dependency-free so the app shell can
 * preconnect/preload them without pulling map code into the initial bundle. Owner: map-engine.
 */
export const BASEMAP_ORIGIN = 'https://tiles.openfreemap.org';
export const BASEMAP_STYLE_URL = `${BASEMAP_ORIGIN}/styles/dark`;
/** The vector TileJSON the dark style names (`sources.openmaptiles.url`, probed 2026-09-30). */
export const BASEMAP_TILEJSON_URL = `${BASEMAP_ORIGIN}/planet`;
