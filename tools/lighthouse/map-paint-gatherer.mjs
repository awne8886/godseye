/**
 * Lighthouse gatherer `MapPaint` (owner: pages-docs-privacy-ops): was the globe on screen at the end
 * of the page load being scored, whatever WebGL renderer drew it? Used by
 * tools/lighthouse/home-config.mjs (Lighthouse CI on `/` under software GL) next to the MapWebGl
 * gatherer; the audit godseye-map-globe-drawn judges both.
 *
 * It runs in the getArtifact phase, i.e. after load, `pauseAfterLoadMs` and the end of tracing, so it
 * never touches the measured window. Lighthouse runs that phase one gatherer at a time; custom
 * artifacts come after the default ones except FullPageScreenshot and BFCacheFailures, which
 * Lighthouse 12 moves to the very end (internalArtifactPriorities in core/config/config.js). This
 * gatherer restores the page before it returns, so those two see it as it was. It reads:
 * - the fallback alerts of src/components/map/WebGLFallback.tsx ("WEBGL2 REQUIRED", "BASEMAP
 *   UNAVAILABLE"), which replace the map;
 * - the diagnostics src/components/map/MapView.tsx writes on the map container: `data-map-ready`
 *   (style parsed, map usable), `data-basemap-state` (ok, incomplete, stalled or offline) and
 *   `data-map-loads` (map constructions in this page load);
 * - the pixels of the map canvas alone: for one screenshot (Page.captureScreenshot clipped to the
 *   canvas at a quarter of its size) every other element is hidden with `visibility: hidden`, then the
 *   style is removed. Script cannot read the WebGL drawing buffer once it has been composited (MapLibre
 *   does not preserve it: a 2D `drawImage` of the map canvas gave 0 opaque pixels on the drawn globe,
 *   measured 2026-10-01), so the screenshot of the composited canvas layer is what a visitor saw.
 */
import { Buffer } from 'node:buffer';
import { Gatherer } from './lighthouse-module.mjs';
import { decodePng, paintStats } from './png.mjs';

/** The MapLibre container inside the map root (same as MAP in e2e/map-engine/helpers.ts). */
export const MAP_CONTAINER = '[data-testid="map-root"] .maplibregl-map';
/** Same selector as tools/lighthouse/map-webgl-gatherer.mjs and tools/gpu-renderer-check.ts. */
export const MAP_CANVAS = '[data-testid="map-root"] canvas.maplibregl-canvas';
/** The two titles of src/components/map/WebGLFallback.tsx (tools/ops-config.test.ts keeps them equal). */
export const FALLBACK_TITLES = ['WEBGL2 REQUIRED', 'BASEMAP UNAVAILABLE'];
/** Screenshot scale: 1350 x 940 CSS px (desktop settings) become 338 x 235 px, enough for colour statistics. */
export const SCREENSHOT_SCALE = 0.25;
/** A software-rendered page answers slowly; the default protocol timeout is 30 s. */
const SCREENSHOT_TIMEOUT_MS = 60_000;
const STYLE_ID = 'godseye-lighthouse-map-paint';

/**
 * Serialised into the page by Lighthouse, so it must be self-contained. Reads the map state and,
 * when a laid-out canvas exists, hides everything else until `restore` runs.
 * @param {{container: string, canvas: string, titles: string[], styleId: string}} a
 */
function readMapState(a) {
  const alerts = [...document.querySelectorAll('[role="alert"]')].map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const fallback = a.titles.find((t) => alerts.some((text) => text.includes(t))) ?? null;
  const container = document.querySelector(a.container);
  const ds = container instanceof HTMLElement ? container.dataset : null;
  const canvas = document.querySelector(a.canvas);
  const r = canvas instanceof HTMLCanvasElement ? canvas.getBoundingClientRect() : null;
  const rect = r && r.width > 0 && r.height > 0 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
  if (rect) {
    const style = document.createElement('style');
    style.id = a.styleId;
    style.textContent = `*{visibility:hidden!important}${a.canvas}{visibility:visible!important}`;
    document.head.append(style);
  }
  return {
    fallback,
    alerts: alerts.slice(0, 5).map((t) => t.slice(0, 200)),
    container: ds !== null,
    mapReady: ds?.mapReady === 'true',
    basemapState: ds?.basemapState ?? null,
    mapLoads: ds?.mapLoads ? Number(ds.mapLoads) : null,
    rect,
  };
}

/** @param {string} styleId */
function restore(styleId) {
  document.getElementById(styleId)?.remove();
}

/**
 * @typedef {import('./png.mjs').PaintStats} PaintStats
 * @typedef {{x: number, y: number, width: number, height: number}} Rect
 * @typedef {{fallback: string|null, alerts: string[], container: boolean, mapReady: boolean, basemapState: string|null, mapLoads: number|null, rect: Rect|null, pixels: PaintStats|null, pixelsError: string|null}} MapPaintArtifact
 */

export default class MapPaint extends Gatherer {
  meta = { supportedModes: ['navigation'] };

  /**
   * @param {{driver: {executionContext: {evaluate: (fn: Function, opts: {args: unknown[]}) => Promise<any>}, defaultSession: {sendCommand: (method: string, params?: unknown) => Promise<any>, setNextProtocolTimeout: (ms: number) => void}}}} context
   * @return {Promise<MapPaintArtifact>}
   */
  async getArtifact(context) {
    const { executionContext, defaultSession } = context.driver;
    const state = await executionContext.evaluate(readMapState, {
      args: [{ container: MAP_CONTAINER, canvas: MAP_CANVAS, titles: FALLBACK_TITLES, styleId: STYLE_ID }],
    });
    /** @type {MapPaintArtifact} */
    const artifact = { ...state, pixels: null, pixelsError: null };
    if (!state.rect) {
      artifact.pixelsError = 'no laid-out map canvas';
      return artifact;
    }
    try {
      defaultSession.setNextProtocolTimeout(SCREENSHOT_TIMEOUT_MS);
      const shot = await defaultSession.sendCommand('Page.captureScreenshot', { format: 'png', clip: { ...state.rect, scale: SCREENSHOT_SCALE } });
      artifact.pixels = paintStats(decodePng(Buffer.from(shot.data, 'base64')));
    } catch (err) {
      artifact.pixelsError = String(/** @type {Error} */ (err).message ?? err).split('\n')[0];
    } finally {
      await executionContext.evaluate(restore, { args: [STYLE_ID] });
    }
    return artifact;
  }
}
