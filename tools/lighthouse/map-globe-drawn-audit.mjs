/**
 * Lighthouse audit `godseye-map-globe-drawn` (owner: pages-docs-privacy-ops): passes only when the
 * globe was drawn in the page load being scored, on any WebGL2 renderer (software included). It is
 * the in-run guard of the software-GL gate on `/` (lighthouserc.home.json asserts it with
 * `minScore: 1` and pessimistic aggregation, so one run that measured a fallback page fails the
 * gate): a page that fell back to "WEBGL2 REQUIRED" or "BASEMAP UNAVAILABLE", or a globe without
 * its basemap, is much lighter than the real page and would pass a performance budget it has not
 * earned.
 *
 * Evidence, all from the scored page load:
 * - MapWebGl (tools/lighthouse/map-webgl-gatherer.mjs): the MapLibre canvas exists and holds a WebGL2
 *   context; its unmasked renderer is reported, not judged;
 * - MapPaint (tools/lighthouse/map-paint-gatherer.mjs): no fallback alert, `data-map-ready="true"`,
 *   a basemap state other than offline, and the map canvas alone painted (at least
 *   MIN_DISTINCT_COLOURS colours, no colour over MAX_DOMINANT_SHARE of it);
 * - the network records of the run (the ones Lighthouse's network-requests audit lists): the MapLibre
 *   worker (requested only after MapLibre has its WebGL context) and at least one basemap vector tile
 *   loaded with HTTP 200 (same rules as tools/gpu-renderer-check.ts --verify-runs).
 */
import { Audit, NetworkRecords } from './lighthouse-module.mjs';

export const AUDIT_ID = 'godseye-map-globe-drawn';

/**
 * Thresholds on the quarter-size screenshot of the map canvas alone (4-bit colour buckets). Measured
 * 2026-10-01 in the build sandbox, Chromium 141 with the SwiftShader flags of lighthouserc.home.json,
 * desktop viewport: the drawn globe 483 colours with 33.5 % in the most common one; the same globe
 * with every basemap tile blocked 465 colours, 38.9 % (deck layers and night lights still draw, so the
 * basemap is checked separately below); a canvas that shows nothing 1 colour, 100 %.
 */
export const MIN_DISTINCT_COLOURS = 64;
export const MAX_DOMINANT_SHARE = 0.9;

/** Same rules as MAPLIBRE_WORKER_PATH and BASEMAP_VECTOR_TILE in tools/gpu-renderer-check.ts (tools/ops-config.test.ts compares them). */
export const MAPLIBRE_WORKER_PATH = /^\/maplibre\/[^/]+\/maplibre-gl-worker\.mjs$/;
export const BASEMAP_VECTOR_TILE = /^https:\/\/tiles\.openfreemap\.org\/planet\/[^/]+\/\d+\/\d+\/\d+\.pbf$/;

/**
 * @typedef {import('./map-paint-gatherer.mjs').MapPaintArtifact} MapPaintArtifact
 * @typedef {{canvas?: boolean, context?: boolean, renderer?: string|null, vendor?: string|null, product?: string}} MapWebGlArtifact
 * @typedef {{url?: unknown, statusCode?: unknown}} RequestLike
 * @typedef {{worker: boolean, vectorTiles: number}} RequestEvidence
 */

/**
 * Whether the MapLibre worker (same origin as the page) and basemap vector tiles loaded with HTTP 200.
 * @param {ReadonlyArray<RequestLike>} requests
 * @param {string | null | undefined} pageUrl
 * @return {RequestEvidence}
 */
export function requestEvidence(requests, pageUrl) {
  const origin = pageUrl && URL.canParse(pageUrl) ? new URL(pageUrl).origin : null;
  /** @param {RequestLike} r */
  const ok = (r) => r.statusCode === 200 && typeof r.url === 'string' && URL.canParse(r.url);
  const worker = requests.some((r) => {
    if (!ok(r)) return false;
    const u = new URL(/** @type {string} */ (r.url));
    return u.origin === origin && MAPLIBRE_WORKER_PATH.test(u.pathname);
  });
  const vectorTiles = requests.filter((r) => ok(r) && BASEMAP_VECTOR_TILE.test(/** @type {string} */ (r.url))).length;
  return { worker, vectorTiles };
}

/**
 * Every reason the globe was not drawn in this run (empty when it was), most decisive first.
 * @param {{webgl: MapWebGlArtifact | null | undefined, paint: MapPaintArtifact | null | undefined, requests: RequestEvidence}} e
 * @return {string[]}
 */
export function globeProblems({ webgl, paint, requests }) {
  const out = [];
  if (!paint) out.push('no map state was read');
  if (paint?.fallback) out.push(`fallback page: ${paint.fallback}`);
  if (!webgl?.canvas) out.push('no map canvas');
  else if (!webgl.context) out.push('no WebGL2 context on the map canvas');
  if (paint) {
    if (!paint.mapReady) out.push('map not ready (data-map-ready is not "true")');
    if (!paint.basemapState || paint.basemapState === 'offline') out.push(`basemap ${paint.basemapState ?? 'state missing'}`);
    const px = paint.pixels;
    if (!px) out.push(`no map canvas pixels (${paint.pixelsError ?? 'not captured'})`);
    else {
      if (px.distinctColours < MIN_DISTINCT_COLOURS) out.push(`blank map canvas: ${px.distinctColours} colours (minimum ${MIN_DISTINCT_COLOURS})`);
      if (px.dominantShare > MAX_DOMINANT_SHARE) out.push(`blank map canvas: ${px.dominantColour} covers ${(px.dominantShare * 100).toFixed(1)} % (maximum ${MAX_DOMINANT_SHARE * 100} %)`);
    }
  }
  if (!requests.worker) out.push('MapLibre worker not loaded with HTTP 200');
  if (requests.vectorTiles === 0) out.push('no basemap vector tile loaded with HTTP 200');
  return out;
}

/**
 * @param {{webgl: MapWebGlArtifact | null | undefined, paint: MapPaintArtifact | null | undefined, requests: RequestEvidence}} e
 * @return {{ok: boolean, displayValue: string, problems: string[]}}
 */
export function judgeGlobeDrawn(e) {
  const problems = globeProblems(e);
  if (problems.length) return { ok: false, displayValue: problems[0], problems };
  const renderer = e.webgl?.renderer ?? 'renderer string withheld';
  const px = /** @type {import('./png.mjs').PaintStats} */ (e.paint?.pixels);
  return {
    ok: true,
    displayValue: `globe drawn on ${renderer}: ${px.distinctColours} colours, basemap ${e.paint?.basemapState}, ${e.requests.vectorTiles} vector tiles`,
    problems,
  };
}

export default class MapGlobeDrawn extends Audit {
  static get meta() {
    return {
      id: AUDIT_ID,
      title: 'Globe drawn in this run (any WebGL2 renderer)',
      failureTitle: 'Globe NOT drawn in this run: the scores describe another page',
      description:
        'The MapLibre canvas held a WebGL2 context and painted (colour statistics of the canvas alone), the map was ready, no "WEBGL2 REQUIRED" or "BASEMAP UNAVAILABLE" fallback was shown, the basemap was not offline, and the MapLibre worker and at least one basemap vector tile loaded with HTTP 200. The renderer may be software (SwiftShader in CI): this audit says the scored page was the globe, not that it ran on a GPU.',
      requiredArtifacts: ['MapWebGl', 'MapPaint', 'DevtoolsLog', 'URL'],
    };
  }

  /**
   * @param {{MapWebGl: MapWebGlArtifact, MapPaint: MapPaintArtifact, DevtoolsLog: unknown, URL: {requestedUrl?: string}}} artifacts
   * @param {unknown} context
   */
  static async audit(artifacts, context) {
    const records = /** @type {RequestLike[]} */ (await NetworkRecords.request(artifacts.DevtoolsLog, context));
    const requests = requestEvidence(records, artifacts.URL.requestedUrl);
    const { ok, displayValue, problems } = judgeGlobeDrawn({ webgl: artifacts.MapWebGl, paint: artifacts.MapPaint, requests });
    return {
      score: ok ? 1 : 0,
      displayValue,
      details: { type: 'debugdata', problems, requests, webgl: artifacts.MapWebGl, paint: artifacts.MapPaint },
    };
  }
}
