import { expect, test, type Page } from '@playwright/test';
import { countTokenPixels, decodePng, MAP, tokenRgb, waitForCameraIdle } from '../map-engine/helpers';
import { openMap } from './helpers';

/**
 * visual-qa round 5 MAJOR-1: hazards point markers were clipped by the globe surface (quake
 * epicentre a half-disc on the phone globe, missing on the desktop globe at z6–8; mercator drew full
 * discs). Every hazards deck layer now draws with `depthCompare: 'always'` + no culling, and only
 * its camera-facing subset (the far-side filter is then the only thing hiding points behind the
 * limb, for drawing and for picking).
 *
 *  1. pixels: the strongest live quake, centred at z8, shows at least half as many marker pixels on
 *     the globe as in mercator (reviewer's repro: globe px ≥ 0.5 × mercator px), and a click on the
 *     globe opens its card (desktop);
 *  2. far side: on a z2.5 globe the drawn count (hidden diagnostics `hazards-drawn-earthquakes`,
 *     with the camera it was filtered with) matches the quakes within the camera horizon
 *     acos(R/(R+h)), and quakes behind the limb are not drawn.
 * Runs against the live /api/earthquakes; SOURCE OFFLINE (503) skips with the reason (asserted).
 */

interface Quake {
  id: string;
  lat: number;
  lng: number;
  magnitude: number;
}

async function liveQuakes(page: Page): Promise<Quake[] | null> {
  const res = await page.request.get('/api/earthquakes');
  const body = await res.json();
  if (res.status() === 503) {
    expect(body.error).toBe('source_offline');
    expect(body.providers.usgs.ok).toBe(false);
    return null;
  }
  expect(res.ok()).toBe(true);
  expect(body.providers.usgs.ok).toBe(true);
  return body.items as Quake[];
}

/** Same scale and colour buckets as src/features/hazards/shared.ts (quakeToken). */
const quakeToken = (m: number) => (m >= 6 ? '--map-seismic-high' : m >= 4 ? '--map-seismic' : '--map-seismic-low');

/** Marker pixels of `token` in a square around the viewport centre (where the quake is). */
async function centrePixels(page: Page, token: string, half = 32): Promise<number> {
  const rgb = await tokenRgb(page, token);
  const v = page.viewportSize()!;
  const img = decodePng(await page.screenshot({ clip: { x: v.width / 2 - half, y: v.height / 2 - half, width: half * 2, height: half * 2 }, animations: 'disabled' }));
  return countTokenPixels(img, rgb, { x: 0, y: 0, width: img.width, height: img.height });
}

async function openQuake(page: Page, q: Quake, proj: 'globe' | 'mercator', zoom: number): Promise<void> {
  await openMap(page, `proj=${proj}&c=${q.lat.toFixed(4)},${q.lng.toFixed(4)},${zoom}&layers=earthquakes`);
  await expect(page.locator('[data-testid="map-root"]')).toHaveAttribute('data-projection', proj, { timeout: 30_000 });
  await expect(page.getByTestId('hazards-drawn-earthquakes')).toHaveAttribute('data-drawn', /^[1-9]\d*$/, { timeout: 45_000 });
  await waitForCameraIdle(page);
}

const R = 6_371_008.8;
const horizonDeg = (m: number) => (m > 0 ? (Math.acos(R / (R + m)) * 180) / Math.PI : 0);
function centralDeg(aLng: number, aLat: number, bLng: number, bLat: number): number {
  const r = Math.PI / 180;
  const h = Math.sin(((bLat - aLat) * r) / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLng - aLng) * r) / 2) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(h)))) / r;
}

test.describe('hazards markers on the globe', () => {
  // openMap() may wait out the basemap style's retry/backoff before it can tell.
  test.beforeEach(() => test.setTimeout(240_000));

  test('a quake marker is drawn whole on the globe (≥ ½ its mercator pixels) and picks', async ({ page }, info) => {
    const quakes = await liveQuakes(page);
    test.skip(quakes === null, 'USGS offline right now: /api/earthquakes answered SOURCE OFFLINE (asserted)');
    // The strongest quake has the biggest marker (2.5–14 px radius) and draws above its neighbours.
    const q = [...quakes!].sort((a, b) => b.magnitude - a.magnitude)[0]!;
    const token = quakeToken(q.magnitude);
    const px: Record<string, number> = {};
    for (const proj of ['mercator', 'globe'] as const) {
      await openQuake(page, q, proj, 8);
      // Poll: the overlay draws on the next map frame after the layer is published.
      await expect.poll(() => centrePixels(page, token), { timeout: 30_000 }).toBeGreaterThanOrEqual(12);
      px[proj] = await centrePixels(page, token);
    }
    test.info().annotations.push({ type: 'pixels', description: `M${q.magnitude} ${token}: mercator ${px.mercator} px, globe ${px.globe} px` });
    expect(px.globe!).toBeGreaterThanOrEqual(0.5 * px.mercator!);
    test.skip(info.project.name === 'mobile', 'the pick half is a desktop pointer test');
    // Globe picking: the marker under the pointer opens its card (still the globe page from above).
    const v = page.viewportSize()!;
    await page.mouse.click(v.width / 2, v.height / 2);
    const card = page.getByTestId('hazard-card').filter({ visible: true }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByTestId('card-source')).toContainText('USGS', { timeout: 10_000 });
  });

  test('globe: quakes behind the limb are not drawn (camera horizon filter)', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'one projection check is enough; the filter is viewport-independent');
    const first = await liveQuakes(page);
    test.skip(first === null, 'USGS offline right now: /api/earthquakes answered SOURCE OFFLINE (asserted)');
    const q = [...first!].sort((a, b) => b.magnitude - a.magnitude)[0]!;
    await openQuake(page, q, 'globe', 2.5);
    const status = page.getByTestId('hazards-drawn-earthquakes');
    await expect(status).toHaveAttribute('data-camera', /^-?\d/, { timeout: 30_000 });
    // The filter camera is the camera the map settled on (data-far-side, written at moveend).
    const near = (a: string | null, b: string | null) => {
      const x = (a ?? '').split(',').map(Number);
      const y = (b ?? '').split(',').map(Number);
      return x.length === 3 && y.length === 3 && Math.abs(x[0]! - y[0]!) <= 0.002 && Math.abs(x[1]! - y[1]!) <= 0.002 && Math.abs(x[2]! - y[2]!) <= 1;
    };
    await expect.poll(async () => near(await status.getAttribute('data-camera'), await page.locator(MAP).getAttribute('data-far-side')), { timeout: 10_000 }).toBe(true);
    const [camLng, camLat, camAlt] = (await status.getAttribute('data-camera'))!.split(',').map(Number) as [number, number, number];
    const drawn = Number(await status.getAttribute('data-drawn'));
    const total = Number(await status.getAttribute('data-total'));
    const quakes = (await liveQuakes(page)) ?? first!;
    const horizon = horizonDeg(camAlt);
    const facing = quakes.filter((x) => centralDeg(camLng, camLat, x.lng, x.lat) <= horizon + 0.05).length;
    test.info().annotations.push({ type: 'far-side', description: `horizon ${horizon.toFixed(1)}°, drawn ${drawn} of ${total}, facing ${facing} of ${quakes.length}` });
    expect(horizon).toBeLessThan(85);
    // The page's snapshot can be one USGS poll older than ours: 10 % + 3 slack.
    expect(Math.abs(drawn - facing)).toBeLessThanOrEqual(Math.ceil(facing * 0.1) + 3);
    test.skip(total - facing <= 3, `every quake but ${total - facing} faces this camera right now: nothing behind the limb to hide`);
    expect(drawn).toBeLessThan(total);
  });
});
