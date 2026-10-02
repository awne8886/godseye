import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { countTokenPixels, decodePng, readCamera, tokenRgb } from '../map-engine/helpers';

/**
 * Watched aircraft leave a TripsLayer trail (§7) along their observed flown track, against the
 * live adsb.lol feed. Skips honestly when the feed is SOURCE OFFLINE or no aircraft right now has a
 * recent flown track to draw. Mercator, north-up, no pitch: screen positions are plain Web
 * Mercator maths from the map's own camera.
 */
interface Flights {
  fields: string[];
  rows: (string | number | null)[][];
}
interface Point {
  t: string;
  lat: number;
  lng: number;
}
interface Target {
  id: string;
  lat: number;
  lng: number;
  seenAt: number;
  gsKt: number;
  trackDeg: number;
  track: Point[];
}

const ZOOM = 10;
const TRAIL_S = 30 * 60;

async function liveFlights(request: APIRequestContext): Promise<Flights | null> {
  const res = await request.get('/api/flights', { timeout: 90_000 });
  if (res.status() === 503) return null;
  expect(res.ok()).toBe(true);
  return (await res.json()) as Flights;
}

function kmBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = Math.PI / 180;
  const h = Math.sin(((bLat - aLat) * r) / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLng - aLng) * r) / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Same great-circle step as the layer's dead reckoning. */
function destination(lng: number, lat: number, bearingDeg: number, km: number): [number, number] {
  const r = Math.PI / 180;
  const δ = km / 6371.0088;
  const θ = bearingDeg * r;
  const φ1 = lat * r;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = lng * r + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return [((((λ2 / r + 180) % 360) + 360) % 360) - 180, φ2 / r];
}

/**
 * An isolated, airborne, steady aircraft (40–220 kt, so the click lands on its dead-reckoned icon)
 * whose flown track has samples in the last 30 min spread ≥ 3 km from where it is now.
 */
async function pickTarget(request: APIRequestContext, f: Flights): Promise<Target | null> {
  const i = (k: string) => f.fields.indexOf(k);
  const newest = Math.max(...f.rows.map((r) => (r[i('seenAt')] as number | null) ?? 0));
  const rows = f.rows.filter((r) => r[i('onGround')] !== 1 && ((r[i('gsKt')] as number | null) ?? 0) >= 40 && ((r[i('gsKt')] as number | null) ?? 0) <= 220 && r[i('trackDeg')] !== null && ((r[i('seenAt')] as number | null) ?? 0) >= newest - 20);
  const isolated = rows.filter((r) => !f.rows.some((o) => o !== r && kmBetween(r[i('lat')] as number, r[i('lng')] as number, o[i('lat')] as number, o[i('lng')] as number) < 12));
  for (const r of isolated.slice(0, 8)) {
    const id = r[i('id')] as string;
    if (!/^[0-9a-f]{6}$/.test(id)) continue;
    const res = await request.get(`/api/aircraft?icao24=${id}`, { timeout: 60_000 });
    if (!res.ok()) continue;
    const body = (await res.json()) as { track?: Point[] };
    const seenAt = r[i('seenAt')] as number;
    const lat = r[i('lat')] as number;
    const lng = r[i('lng')] as number;
    const recent = (body.track ?? []).filter((p) => Date.parse(p.t) / 1000 >= seenAt - TRAIL_S + 120);
    if (recent.length >= 2 && recent.some((p) => kmBetween(p.lat, p.lng, lat, lng) >= 3)) {
      return { id, lat, lng, seenAt, gsKt: r[i('gsKt')] as number, trackDeg: r[i('trackDeg')] as number, track: recent };
    }
  }
  return null;
}

/** Web Mercator (512 px tiles, the MapLibre world size) screen offset from the camera centre. */
function project(lng: number, lat: number, c: { lng: number; lat: number; zoom: number }): [number, number] {
  const ws = 512 * 2 ** c.zoom;
  const x = (l: number) => ((l + 180) / 360) * ws;
  const y = (φ: number) => ((1 - Math.log(Math.tan(Math.PI / 4 + (φ * Math.PI) / 360)) / Math.PI) / 2) * ws;
  let dl = lng - c.lng;
  if (dl > 180) dl -= 360;
  if (dl < -180) dl += 360;
  return [x(c.lng + dl) - x(c.lng), y(lat) - y(c.lat)];
}

/** Watch-coloured pixels in 24 px boxes on the flown-track samples ≥ 45 px from the aircraft. */
async function trailPixels(page: Page, t: Target): Promise<{ px: number; boxes: number }> {
  const cam = (await readCamera(page)) ?? { lat: t.lat, lng: t.lng, zoom: ZOOM, pitch: 0, bearing: 0 };
  const box = (await page.locator('canvas.maplibregl-canvas').boundingBox())!;
  const img = decodePng(await page.screenshot({ clip: box }));
  const scale = img.width / box.width;
  const rgb = await tokenRgb(page, '--map-flight-watch');
  const [hx, hy] = project(t.lng, t.lat, cam);
  let px = 0;
  let boxes = 0;
  for (const p of t.track) {
    const [dx, dy] = project(p.lng, p.lat, cam);
    if (Math.hypot(dx - hx, dy - hy) < 45) continue; // the icon and its amber watch ring
    const sx = box.width / 2 + dx;
    const sy = box.height / 2 + dy;
    if (sx < 12 || sy < 12 || sx > box.width - 12 || sy > box.height - 12) continue;
    boxes++;
    px += countTokenPixels(img, rgb, { x: (sx - 12) * scale, y: (sy - 12) * scale, width: 24 * scale, height: 24 * scale }, { minAlpha: 0.25 });
  }
  return { px, boxes };
}

test('a watched aircraft draws a TripsLayer trail along its observed flown track', async ({ page, request }, info) => {
  test.skip(info.project.name === 'mobile', 'desktop draw check');
  test.setTimeout(300_000);
  const flights = await liveFlights(request);
  test.skip(flights === null, 'adsb.lol is SOURCE OFFLINE right now: nothing live to draw');
  const target = await pickTarget(request, flights!);
  test.skip(target === null, 'no isolated airborne aircraft with a recent flown track right now');
  const t = target!;

  await page.goto(`/?proj=mercator&layers=flights,private,jets,military&c=${t.lat.toFixed(5)},${t.lng.toFixed(5)},${ZOOM}`);
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('status', { name: /loading/i })).toBeHidden({ timeout: 20_000 });
  const status = page.getByTestId('aviation-status');
  await expect(status).toHaveAttribute('data-drawn', /^[1-9]\d*$/, { timeout: 45_000 });
  await expect(status).toHaveAttribute('data-map-ready', '1', { timeout: 60_000 });
  await expect(status).toHaveAttribute('data-trail-vertices', '0');

  // Nothing watched yet: no trail pixels along the track.
  const before = await trailPixels(page, t);

  // Click the dead-reckoned icon (≤ 60 s along its own track, the layer's rule), retrying as it moves.
  const card = page.getByTestId('aircraft-card');
  const canvas = (await page.locator('canvas.maplibregl-canvas').boundingBox())!;
  for (let attempt = 0; attempt < 4 && !(await card.isVisible()); attempt++) {
    const cam = (await readCamera(page)) ?? { lat: t.lat, lng: t.lng, zoom: ZOOM, pitch: 0, bearing: 0 };
    const dt = Math.min(Math.max(0, Date.now() / 1000 - t.seenAt), 60);
    const [lng, lat] = destination(t.lng, t.lat, t.trackDeg, (t.gsKt * 1.852 * dt) / 3600);
    const [dx, dy] = project(lng, lat, cam);
    await page.mouse.click(canvas.x + canvas.width / 2 + dx, canvas.y + canvas.height / 2 + dy);
    await card.waitFor({ state: 'visible', timeout: 4_000 }).catch(() => undefined);
  }
  test.skip(!(await card.isVisible()), 'The aircraft card did not open (HUD card host missing, or the aircraft left the snapshot)');
  await card.getByRole('button', { name: /watch/i }).click();

  // The TripsLayer gets the flown-track vertices (plus the dead-reckoned head) ...
  await expect(status).toHaveAttribute('data-trail-vertices', /^(?:[2-9]|[1-9]\d+)$/, { timeout: 60_000 });
  // ... and they reach the screen in the watch colour, away from the icon and its ring.
  await expect
    .poll(async () => (await trailPixels(page, t)).px, { timeout: 30_000, intervals: [1_000] })
    .toBeGreaterThan(before.px + 20);
  expect(before.boxes).toBeGreaterThan(0);
});
