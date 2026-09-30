/**
 * Browser-facing host allow-lists. These drive the Content-Security-Policy and
 * `next/image` remotePatterns. The browser may only talk to map tile hosts and
 * official video/embed hosts directly (§11: "no browser request to an upstream
 * except tiles and video embeds"); every data feed goes through /api.
 *
 * Owner: lead (shared file). Builders request additions in their report.
 */

/** Map tile, style, glyph and sprite hosts fetched by MapLibre in the browser. */
export const TILE_HOSTS = [
  'https://tiles.openfreemap.org',
  'https://server.arcgisonline.com',
  'https://gibs.earthdata.nasa.gov',
  'https://s3.amazonaws.com', // AWS Terrain Tiles (Terrarium) — elevation-tiles-prod bucket
] as const;

/** Official embed hosts allowed in <iframe> (YouTube live channels, ISS stream). */
export const FRAME_HOSTS = [
  'https://www.youtube-nocookie.com',
  'https://www.youtube.com',
] as const;

/**
 * Hosts whose images the browser may load directly (thumbnails in panels).
 * Camera stills are never loaded from here: they go through the stills-only
 * /api/cctv/proxy with an exact-prefix allow-list.
 */
export const IMAGE_HOSTS = [
  'https://i.ytimg.com',
  'https://upload.wikimedia.org',
] as const;

/**
 * Direct video/HLS hosts for official public camera streams (populated by the
 * surveillance builder from its provider registry; each entry must be an
 * operator's own public streaming host).
 */
export const MEDIA_HOSTS: readonly string[] = [];

export type HostList = readonly string[];
