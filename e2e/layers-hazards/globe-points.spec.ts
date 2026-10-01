import { expect, test, type Page } from '@playwright/test';
import { countTokenPixels, decodePng, MAP, nudgeMap, readCamera, tokenRgb, waitForCameraIdle } from '../map-engine/helpers';
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
 *  2. far side, at pitch 0 and pitch 60: on a z2.5 globe the camera the layer filtered with (hidden
 *     diagnostics `hazards-drawn-earthquakes`) matches the pitched camera computed independently
 *     here from data-camera, the drawn count matches the quakes within its horizon acos(R/(R+h)),
 *     and quakes behind the limb are not drawn.
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

async function openQuake(page: Page, q: Quake, proj: 'globe' | 'mercator', zoom: number, pitch = 0): Promise<void> {
  const tilt = pitch ? `,${pitch},0` : '';
  await openMap(page, `proj=${proj}&c=${q.lat.toFixed(4)},${q.lng.toFixed(4)},${zoom}${tilt}&layers=earthquakes`);
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

/**
 * Ground point + altitude of MapLibre's camera from centre/zoom/pitch/bearing and the canvas height
 * (default 36.87° FOV: camera-to-centre distance 1.5 × height px), written out here rather than
 * imported so the check does not share code with the app (visual-qa round 5: the pitch-0 check was
 * circular). Matches MapLibre's getCameraLngLat()/getCameraAltitude() to within 0.1° / 0.05 %.
 */
function expectedCamera(lng: number, lat: number, zoom: number, pitchDeg: number, bearingDeg: number, heightPx: number) {
  const r = Math.PI / 180;
  const d = (1.5 * heightPx * 2 * Math.PI * Math.cos(lat * r)) / (512 * 2 ** zoom);
  const up = 1 + d * Math.cos(pitchDeg * r);
  const back = d * Math.sin(pitchDeg * r);
  const g = Math.atan2(back, up);
  const brg = (bearingDeg + 180) * r;
  const p1 = lat * r;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(g) + Math.cos(p1) * Math.sin(g) * Math.cos(brg));
  const l2 = lng * r + Math.atan2(Math.sin(brg) * Math.sin(g) * Math.cos(p1), Math.cos(g) - Math.sin(p1) * Math.sin(p2));
  return { lng: ((((l2 / r + 180) % 360) + 360) % 360) - 180, lat: p2 / r, altitude: (Math.hypot(up, back) - 1) * R };
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
    // Globe picking (desktop pointer; the phone layout is covered by the pixel half above): the
    // marker under the pointer opens its card (still the globe page from the loop).
    if (info.project.name === 'mobile') return;
    const v = page.viewportSize()!;
    await page.mouse.click(v.width / 2, v.height / 2);
    const card = page.getByTestId('hazard-card').filter({ visible: true }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByTestId('card-source')).toContainText('USGS', { timeout: 10_000 });
  });

  for (const pitch of [0, 60] as const) {
    test(`globe pitch ${pitch}: quakes behind the limb are not drawn (pitched camera horizon filter)`, async ({ page }, info) => {
      test.skip(info.project.name === 'mobile', 'one projection check is enough; the filter is viewport-independent');
      const first = await liveQuakes(page);
      test.skip(first === null, 'USGS offline right now: /api/earthquakes answered SOURCE OFFLINE (asserted)');
      const q = [...first!].sort((a, b) => b.magnitude - a.magnitude)[0]!;
      await openQuake(page, q, 'globe', 2.5, pitch);
      const status = page.getByTestId('hazards-drawn-earthquakes');
      await expect(status).toHaveAttribute('data-camera', /^-?\d/, { timeout: 30_000 });
      // A small drag: the layer must refilter with the camera the map settles on (the host writes
      // data-camera / data-far-side at moveend only, so the initial ?c= camera has none to compare with).
      await nudgeMap(page);
      await waitForCameraIdle(page);
      const view = await readCamera(page);
      expect(view).not.toBeNull();
      expect(view!.pitch).toBeCloseTo(pitch, 0);
      const height = await page.locator('canvas.maplibregl-canvas').evaluate((c) => (c as HTMLCanvasElement).clientHeight);
      // Independent of the app's camera code: the ground point and altitude of the pitched camera.
      const want = expectedCamera(view!.lng, view!.lat, view!.zoom, view!.pitch ?? 0, view!.bearing ?? 0, height);
      const parse = (a: string | null) => (a ?? '').split(',').map(Number);
      const close = (a: string | null) => {
        const x = parse(a);
        // data-camera rounds zoom to 0.01 (≤ 0.35 % altitude) and lng/lat to 1e-4.
        return x.length === 3 && centralDeg(x[0]!, x[1]!, want.lng, want.lat) <= 0.15 && Math.abs(x[2]! - want.altitude) <= 0.01 * want.altitude;
      };
      await expect.poll(async () => close(await status.getAttribute('data-camera')), { timeout: 10_000 }).toBe(true);
      if (pitch === 0) {
        // Untilted, the host's data-far-side is the same camera.
        const near = (a: string | null, b: string | null) => {
          const x = parse(a);
          const y = parse(b);
          return x.length === 3 && y.length === 3 && Math.abs(x[0]! - y[0]!) <= 0.002 && Math.abs(x[1]! - y[1]!) <= 0.002 && Math.abs(x[2]! - y[2]!) <= 1;
        };
        await expect.poll(async () => near(await status.getAttribute('data-camera'), await page.locator(MAP).getAttribute('data-far-side')), { timeout: 10_000 }).toBe(true);
      } else {
        // Tilted, the camera's ground point is well behind the map centre (the round-5 bug used the centre).
        expect(centralDeg(view!.lng, view!.lat, want.lng, want.lat)).toBeGreaterThan(10);
      }
      const [camLng, camLat, camAlt] = parse(await status.getAttribute('data-camera')) as [number, number, number];
      const drawn = Number(await status.getAttribute('data-drawn'));
      const total = Number(await status.getAttribute('data-total'));
      const quakes = (await liveQuakes(page)) ?? first!;
      const horizon = horizonDeg(camAlt);
      const facing = quakes.filter((x) => centralDeg(camLng, camLat, x.lng, x.lat) <= horizon + 0.05).length;
      const facingWanted = quakes.filter((x) => centralDeg(want.lng, want.lat, x.lng, x.lat) <= horizonDeg(want.altitude)).length;
      test.info().annotations.push({ type: 'far-side', description: `pitch ${pitch}: horizon ${horizon.toFixed(1)}°, drawn ${drawn} of ${total}, facing ${facing} (independent camera: ${facingWanted}) of ${quakes.length}` });
      expect(horizon).toBeLessThan(85);
      // The page's snapshot can be one USGS poll older than ours: 10 % + 3 slack.
      expect(Math.abs(drawn - facing)).toBeLessThanOrEqual(Math.ceil(facing * 0.1) + 3);
      expect(Math.abs(drawn - facingWanted)).toBeLessThanOrEqual(Math.ceil(facingWanted * 0.1) + 3);
      test.skip(total - facing <= 3, `every quake but ${total - facing} faces this camera right now: nothing behind the limb to hide`);
      expect(drawn).toBeLessThan(total);
    });
  }
});
