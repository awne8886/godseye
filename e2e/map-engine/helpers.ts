/**
 * Reusable Playwright helpers for every builder's map specs (owner: map-engine).
 *
 *   await gotoMap(page, { camera: { lat: 51.5, lng: -0.12, zoom: 9 }, params: { layers: 'flights' } });
 *   await waitForMapIdle(page);
 *   const cam = await readCamera(page);
 *
 * The map host writes diagnostics on its container (`.maplibregl-map`):
 *  - data-style-ready / data-map-ready: the style JSON is parsed and the map is usable (published to
 *    feature modules: sources/layers can be added, clicks and camera requests are served). Neither
 *    waits for tiles (a hung tile host must not hold the app back, R1r3-M1) nor for the camera;
 *  - data-camera-idle: "true" while no fly/ease/drag is in progress (wait for it before clicking a
 *    precise map position);
 *  - data-map-loads (map constructions this page), data-camera (lat,lng,zoom,pitch,bearing at the
 *    last moveend), data-far-side (camera ground point + altitude on the globe, else "none"),
 *    data-basemap-state (ok/offline/incomplete/stalled), data-admission-pending (start-up units
 *    queued), data-deck-layers / data-deck-undrawn (deck layers handed over / groups not in the style).
 * The wrapper `[data-testid=map-root]` carries data-projection (effective) and data-basemap.
 */
import { expect, type Page } from '@playwright/test';

export interface CameraArg {
  lat: number;
  lng: number;
  zoom: number;
  pitch?: number;
  bearing?: number;
}

export const MAP = '[data-testid="map-root"] .maplibregl-map';

/** `?c=` value for a camera (same format as src/lib/url-state.ts). */
export function cameraParam(c: CameraArg): string {
  const parts = [c.lat, c.lng, c.zoom];
  if (c.pitch !== undefined || c.bearing !== undefined) parts.push(c.pitch ?? 0, c.bearing ?? 0);
  return parts.join(',');
}

/** Open the app with a camera (`?c=`) and any other URL params (layers, proj, theme…). */
export async function gotoMap(page: Page, opts: { camera?: CameraArg; params?: Record<string, string> } = {}): Promise<void> {
  const q = new URLSearchParams(opts.params ?? {});
  if (opts.camera) q.set('c', cameraParam(opts.camera));
  const qs = q.toString();
  await page.goto(qs ? `/?${qs}` : '/');
  // The style is fetched from OpenFreeMap with a 15 s deadline per try and retries after 2, 4, 8, 16, 30 s…
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 90_000 });
  // The HUD splash covers the map (and swallows pointer events) until it lifts (≤ 7 s cap).
  await expect(page.getByRole('status', { name: /loading/i })).toBeHidden({ timeout: 30_000 });
}

/**
 * Wait until the map is ready: style parsed and the map published to feature modules (tiles may
 * still be loading; see the header). The generous default covers a slow style host behind sandbox
 * egress proxies (the style is retried after 2, 4, 8, 16, then every 30 s).
 */
export async function waitForMapIdle(page: Page, timeout = 120_000): Promise<void> {
  await expect(page.locator(MAP)).toHaveAttribute('data-map-ready', 'true', { timeout });
}

/** Wait until the camera has stopped (no fly/ease/drag in progress), e.g. before clicking the map. */
export async function waitForCameraIdle(page: Page, timeout = 60_000): Promise<void> {
  await expect(page.locator(MAP)).toHaveAttribute('data-camera-idle', 'true', { timeout });
}

/** Wait until the map exists and its style is parsed (tiles may still be loading). */
export async function waitForMapStyle(page: Page, timeout = 60_000): Promise<void> {
  await expect(page.locator(MAP)).toHaveAttribute('data-style-ready', 'true', { timeout });
}

/** Camera recorded at the last moveend, or null before the first move. */
export async function readCamera(page: Page): Promise<CameraArg | null> {
  const raw = await page.locator(MAP).getAttribute('data-camera');
  if (!raw) return null;
  const [lat, lng, zoom, pitch, bearing] = raw.split(',').map(Number) as [number, number, number, number, number];
  return { lat, lng, zoom, pitch, bearing };
}

/** Far-side camera (ground point + altitude in metres) or null in mercator / before the first move. */
export async function readFarSideCamera(page: Page): Promise<{ lng: number; lat: number; altitude: number } | null> {
  const raw = await page.locator(MAP).getAttribute('data-far-side');
  if (!raw || raw === 'none') return null;
  const [lng, lat, altitude] = raw.split(',').map(Number) as [number, number, number];
  return { lng, lat, altitude };
}

export async function mapProjection(page: Page): Promise<string | null> {
  return page.locator('[data-testid="map-root"]').getAttribute('data-projection');
}

export async function mapLoads(page: Page): Promise<number> {
  return Number(await page.locator(MAP).getAttribute('data-map-loads'));
}

/** Nudge the camera so a moveend fires (and data-camera / data-far-side are written). */
export async function nudgeMap(page: Page): Promise<void> {
  const box = await page.locator('canvas.maplibregl-canvas').boundingBox();
  if (!box) throw new Error('map canvas not laid out');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 12, y + 4, { steps: 4 });
  await page.mouse.up();
}

/**
 * Same-origin routes another builder has not shipped yet: Next prefetches their links and logs a
 * 404. Remove entries as those routes land (tracked in TODO.md).
 */
export const PENDING_ROUTES = [/^\/docs(\?|$)/, /^\/privacy(\?|$)/];

/**
 * Collect console errors and uncaught page errors from now on. With E2E_IGNORE_HTTPS_ERRORS=1
 * (sandboxes behind a re-signing egress proxy) transport failures (`net::ERR_*`) are the proxy's,
 * not the app's, and are ignored; HTTP status errors and script errors always count.
 */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  const sandbox = process.env.E2E_IGNORE_HTTPS_ERRORS === '1';
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    const url = m.location().url ?? '';
    if (sandbox && /net::ERR_/.test(text)) return;
    try {
      const u = new URL(url);
      const local = ['127.0.0.1', 'localhost'].includes(u.hostname);
      if (/404/.test(text) && local && PENDING_ROUTES.some((r) => r.test(u.pathname + u.search))) return;
      // An upstream that is down makes our own route answer 503 SOURCE OFFLINE (§0: never an empty
      // 200); Chrome logs every non-2xx fetch as a console error. That is the app being honest about a
      // third party, not an app error — the layer's own spec checks how it is shown.
      if (/status of 503/.test(text) && local && u.pathname.startsWith('/api/')) return;
    } catch {
      /* no location: keep the error */
    }
    errors.push(`${text}${url ? ` @ ${url}` : ''}`);
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/** Pixels of `token`'s colour inside `rect` (fractions of the canvas), decoded from a screenshot. */
export async function tokenPixels(page: Page, token: string, rect = { x0: 0.08, y0: 0.15, x1: 0.62, y1: 0.85 }): Promise<number> {
  const box = (await page.locator('canvas.maplibregl-canvas').boundingBox())!;
  const clip = { x: box.x + box.width * rect.x0, y: box.y + box.height * rect.y0, width: box.width * (rect.x1 - rect.x0), height: box.height * (rect.y1 - rect.y0) };
  const png = (await page.screenshot({ clip })).toString('base64');
  return page.evaluate(
    async ({ png, token }) => {
      const probe = document.createElement('i');
      probe.style.color = `var(${token})`;
      document.body.append(probe);
      const rgb = getComputedStyle(probe).color.match(/\d+(\.\d+)?/g)?.map(Number);
      probe.remove();
      if (!rgb || rgb.length < 3) return -1;
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let p = 0; p < px.length; p += 4) if (Math.abs(px[p]! - rgb[0]!) + Math.abs(px[p + 1]! - rgb[1]!) + Math.abs(px[p + 2]! - rgb[2]!) <= 60) n++;
      return n;
    },
    { png, token },
  );
}
