/**
 * Reusable Playwright helpers for every builder's map specs (owner: map-engine).
 *
 *   await gotoMap(page, { camera: { lat: 51.5, lng: -0.12, zoom: 9 }, params: { layers: 'flights' } });
 *   await waitForMapIdle(page);
 *   const cam = await readCamera(page);
 *
 * The map host writes diagnostics on its container (`.maplibregl-map`): data-map-ready (first
 * idle), data-map-loads (map constructions this page), data-camera (lat,lng,zoom,pitch,bearing at
 * the last moveend) and data-far-side (camera ground point + altitude on the globe, else "none").
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
  // The style is fetched from OpenFreeMap with retry/backoff (4, 8, 16, 32 s…): allow for a slow first try.
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 90_000 });
  // The HUD splash covers the map (and swallows pointer events) until it lifts (≤ 7 s cap).
  await expect(page.getByRole('status', { name: /loading/i })).toBeHidden({ timeout: 30_000 });
}

/**
 * Wait until the map has gone idle once (style, sprite, glyphs and first tiles settled). Tile hosts
 * can be slow behind sandbox egress proxies, hence the generous default.
 */
export async function waitForMapIdle(page: Page, timeout = 120_000): Promise<void> {
  await expect(page.locator(MAP)).toHaveAttribute('data-map-ready', 'true', { timeout });
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
      if (/404/.test(text) && ['127.0.0.1', 'localhost'].includes(u.hostname) && PENDING_ROUTES.some((r) => r.test(u.pathname + u.search))) return;
    } catch {
      /* no location: keep the error */
    }
    errors.push(`${text}${url ? ` @ ${url}` : ''}`);
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}
