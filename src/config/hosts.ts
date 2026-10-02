/**
 * Browser-facing host allow-lists. These drive the Content-Security-Policy, and OPTIMISED_IMAGE_HOSTS
 * the `next/image` remotePatterns. The browser may only talk to map tile hosts and
 * official video/embed hosts directly (§11: "no browser request to an upstream
 * except tiles and video embeds"); every data feed goes through /api.
 *
 * Owner: lead (shared file). Builders request additions in their report.
 */

/**
 * Map tile, style, glyph and sprite sources fetched by MapLibre in the browser. Entries with a
 * path are CSP directory prefixes (must end in '/'), so a shared host like s3.amazonaws.com only
 * admits the one bucket.
 */
export const TILE_HOSTS = [
  'https://tiles.openfreemap.org',
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/',
  'https://gibs.earthdata.nasa.gov/wmts/',
  'https://s3.amazonaws.com/elevation-tiles-prod/', // AWS Terrain Tiles (Terrarium)
  'https://tilecache.rainviewer.com/', // RainViewer radar tiles (metadata goes through /api)
] as const;

/** Official embed hosts allowed in <iframe> (YouTube live channels, ISS stream). */
export const FRAME_HOSTS = [
  'https://www.youtube-nocookie.com',
  'https://www.youtube.com',
] as const;

/**
 * Image sources for panel thumbnails, rendered through next/image (the optimiser fetches them
 * server-side) and allowed in img-src for plain <img> fallbacks. Camera stills are never loaded
 * from here: they go through the stills-only /api/cctv/proxy with an exact-prefix allow-list.
 */
export const IMAGE_HOSTS = [
  'https://i.ytimg.com/vi/',
  'https://upload.wikimedia.org/wikipedia/commons/',
  'https://image.airport-data.com/aircraft/', // adsbdb aircraft photos (credited on the card)
  'https://airport-data.com/images/aircraft/',
  'https://zipper.creodias.eu/odata/v1/', // Copernicus Data Space quicklooks (final URL; no redirects followed)
  'https://*.telesco.pe/file/', // public Telegram channel media (t.me/s previews)
] as const;

/**
 * The only IMAGE_HOSTS the server-side optimiser (/_next/image) fetches: the Sentinel quicklook card
 * is its only consumer. Every other image loads directly in the browser (img-src), so the optimiser
 * is not an open proxy with a disk cache for the rest (r10 security).
 */
export const OPTIMISED_IMAGE_HOSTS = ['https://zipper.creodias.eu/odata/v1/'] as const satisfies readonly (typeof IMAGE_HOSTS)[number][];

/**
 * Direct video/HLS sources for official public camera streams and channel media: each entry is
 * an operator's own public streaming host (or path), never a re-streamer. Non-commercial-only
 * hosts are not listed here; they would need a licence-gated CSP.
 */
export const MEDIA_HOSTS = [
  'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/', // TfL JamCams mp4 loops
  'https://wzmedia.dot.ca.gov/', // Caltrans CCTV HLS (ACAO *)
  'https://*.telesco.pe/file/', // public Telegram channel video
  'https://*.cdn-telegram.org/file/',
] as const;

export type HostList = readonly string[];
