/**
 * Basemap style + TileJSON download for the first globe paint. The OpenFreeMap "dark" style names
 * its vector TileJSON (`/planet`) in `sources.openmaptiles.url`; fetching the two one after the
 * other cost a full round trip before MapLibre could even be constructed. The TileJSON we expect
 * is requested in parallel with the style and used only if the style really names that URL;
 * any other URL is fetched after the style as before. A failure of either rejects (the caller
 * retries with backoff — never a blank globe pretending to be a map).
 * The URLs are constants so the app shell can `preconnect`/`preload` them (they match these
 * requests: CORS, credentials `same-origin`, which sends nothing cross-origin). Owner: map-engine.
 */
import type { StyleSpecification } from 'maplibre-gl';
import { BASEMAP_STYLE_URL, BASEMAP_TILEJSON_URL } from './basemap-urls';
import { inlineTileJson, parseTileJson, tileJsonUrl } from './style-transform';

type FetchLike = (url: string, init: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

const INIT = (signal: AbortSignal): RequestInit => ({ signal, credentials: 'same-origin' });

async function getJson(fetchFn: FetchLike, url: string, signal: AbortSignal, what: string): Promise<unknown> {
  const res = await fetchFn(url, INIT(signal));
  if (!res.ok) throw new Error(`${what} HTTP ${res.status}`);
  return res.json();
}

/** The upstream style with its vector TileJSON inlined (unthemed). */
export async function fetchBasemapStyle(signal: AbortSignal, fetchFn: FetchLike = fetch): Promise<StyleSpecification> {
  const early = getJson(fetchFn, BASEMAP_TILEJSON_URL, signal, 'basemap TileJSON');
  early.catch(() => undefined); // observed below when used; an unused early failure is not an error
  const raw = (await getJson(fetchFn, BASEMAP_STYLE_URL, signal, 'basemap style')) as StyleSpecification;
  const tj = tileJsonUrl(raw);
  if (!tj) return raw;
  const body = tj === BASEMAP_TILEJSON_URL ? await early : await getJson(fetchFn, tj, signal, 'basemap TileJSON');
  return inlineTileJson(raw, parseTileJson(body, tj));
}
