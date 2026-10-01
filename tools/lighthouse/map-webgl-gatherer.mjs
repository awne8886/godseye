/**
 * Lighthouse gatherer `MapWebGl` (owner: pages-docs-privacy-ops): which WebGL2 renderer drew the
 * MapLibre globe in the page load Lighthouse is scoring.
 *
 * Runs in Lighthouse's own Chromium (launched by chrome-launcher with the config's chromeFlags) in
 * the `getArtifact` phase, i.e. after load, `pauseAfterLoadMs` and the end of tracing, so it never
 * touches the measured window. It reads MapLibre's existing context (getContext returns the context
 * a canvas already holds) and, on a fresh canvas, whether Chromium hands out a WebGL2 context that
 * refuses a major performance caveat (software rendering).
 */
import { Gatherer } from './lighthouse-module.mjs';

/** The one MapLibre canvas (src/components/map/MapView.tsx); same selector as tools/gpu-renderer-check.ts. */
export const MAP_CANVAS = '[data-testid="map-root"] canvas.maplibregl-canvas';

/**
 * Serialised into the page by Lighthouse, so it must be self-contained.
 * @param {string} selector
 */
function probeMapWebGl(selector) {
  /** @param {unknown} v */
  const text = (v) => (typeof v === 'string' && v ? v : null);
  /** @param {WebGL2RenderingContext} gl */
  const strings = (gl) => {
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      renderer: text(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)),
      vendor: text(gl.getParameter(info ? info.UNMASKED_VENDOR_WEBGL : gl.VENDOR)),
      version: text(gl.getParameter(gl.VERSION)),
    };
  };
  const canvas = document.querySelector(selector);
  const fresh = document.createElement('canvas').getContext('webgl2', { failIfMajorPerformanceCaveat: true });
  const hardwareContext = fresh !== null;
  fresh?.getExtension('WEBGL_lose_context')?.loseContext();
  if (!(canvas instanceof HTMLCanvasElement)) return { canvas: false, context: false, renderer: null, vendor: null, version: null, hardwareContext };
  const gl = canvas.getContext('webgl2');
  if (!gl) return { canvas: true, context: false, renderer: null, vendor: null, version: null, hardwareContext };
  return { canvas: true, context: true, ...strings(gl), hardwareContext };
}

/**
 * Chromium's own GPU report (chrome://gpu feature status and devices). SystemInfo is served only on
 * the browser target, so it goes over the root session of Lighthouse's puppeteer connection.
 * @param {{createCDPSession: () => Promise<{connection: () => ({send: (method: string) => Promise<any>}|undefined), detach: () => Promise<void>}>}} page
 */
async function systemGpu(page) {
  const session = await page.createCDPSession();
  try {
    const connection = session.connection();
    if (!connection) throw new Error('no browser connection');
    const info = await connection.send('SystemInfo.getInfo');
    return { featureStatus: info.gpu.featureStatus ?? {}, devices: info.gpu.devices ?? [], error: null };
  } catch (err) {
    return { featureStatus: null, devices: [], error: String(/** @type {Error} */ (err).message ?? err).split('\n')[0] };
  } finally {
    await session.detach().catch(() => {});
  }
}

export default class MapWebGl extends Gatherer {
  meta = { supportedModes: ['navigation'] };

  /**
   * @param {{driver: {executionContext: {evaluate: (fn: Function, opts: {args: unknown[]}) => Promise<any>}, defaultSession: {sendCommand: (method: string) => Promise<any>}}, page: any}} context
   */
  async getArtifact(context) {
    const probe = await context.driver.executionContext.evaluate(probeMapWebGl, { args: [MAP_CANVAS] });
    // Full version ("Chrome/153.0.8010.12"); the user agent in the report is reduced to "153.0.0.0".
    const { product } = await context.driver.defaultSession.sendCommand('Browser.getVersion');
    return { ...probe, product, gpu: await systemGpu(context.page) };
  }
}
