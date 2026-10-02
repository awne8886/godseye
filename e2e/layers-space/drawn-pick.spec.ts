import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { SATELLITE_FIELDS } from '../../src/lib/schemas/space-fields';
import { CATEGORY_TOKEN, MISSIONS, countByCategory, ommToRecord, recordToOmm, recordToRow, type SatRecord } from '../../src/features/space/lib/catalog';
import { propagateAt, satrecFromOmm } from '../../src/features/space/lib/orbit';
import { inEarthShadow, sunDirection } from '../../src/features/space/lib/shadow';
import { decodePng, gotoMap, tokenRgb, waitForAdmissionDrained, waitForCameraIdle, waitForMapIdle } from '../map-engine/helpers';

/**
 * Verification round 10, MAJOR 1: satellites were drawn at their display altitude (450–1750 km)
 * in every projection, so under MapLibre's perspective camera a GEO marker sat ~120 px off its
 * ground point in mercator at z5 (and behind the camera at z7), ~200 px off on the globe at z5 —
 * while the CPU hit-test also accepted the bare ground point, so a click on empty map opened a card.
 * Now mercator draws flat (marker = ground point) and only the drawn marker is hit.
 *
 * The catalogue is served from the recorded CelesTrak fixture, trimmed to ONE geostationary
 * satellite, so nothing depends on live CelesTrak and the only satellite pixels on screen are its
 * marker. The ground point is located through the cursor readout (the map's own unprojection).
 */

/** Equatorial GEO satellites in the fixture, far apart in longitude (one of them is out of Earth's shadow). */
const CANDIDATES = [41238 /* BELINTERSAT-1 */, 43039 /* ALCOMSAT 1 */, 35491 /* EWS-G3 */, 39070 /* TDRS 11 */];
const HIT_PX = 10; // SAT_HIT_PX in src/features/space/client/pick.ts

const active = JSON.parse(readFileSync(new URL('../../src/features/space/__fixtures__/celestrak-active-sample.json', import.meta.url), 'utf8')) as { capturedAt: string; data: Record<string, unknown>[] };
const records = active.data.map((o) => ommToRecord(o)).filter((r): r is SatRecord => !!r);

/** The first candidate that is lit now and for the next 10 minutes (shadowed markers are dimmed to 30 %). */
function pickTarget(): { rec: SatRecord; lng: number; lat: number } {
  for (const id of CANDIDATES) {
    const rec = records.find((r) => r.noradId === id);
    const satrec = rec && satrecFromOmm(recordToOmm(rec));
    if (!rec || !satrec) continue;
    const now = Date.now();
    const lit = [0, 5, 10].every((m) => {
      const p = propagateAt(satrec, new Date(now + m * 60_000));
      return p && !inEarthShadow(p.lat, p.lng, p.altKm, sunDirection(now + m * 60_000));
    });
    const p = propagateAt(satrec, new Date(now));
    if (lit && p) return { rec, lng: p.lng, lat: p.lat };
  }
  throw new Error('no candidate GEO satellite is lit right now');
}

/** /api/satellites (not /api/satellites/orbit) answered with a one-satellite catalogue. */
async function serveCatalogue(page: Page, rec: SatRecord): Promise<void> {
  const rows = [recordToRow(rec)];
  const at = active.capturedAt;
  const body = {
    fields: SATELLITE_FIELDS,
    rows,
    missions: MISSIONS,
    categoryCounts: countByCategory(rows),
    catalogueSource: 'celestrak',
    epochUnit: 'ms',
    meta: { feed: 'satellites', kind: 'live', state: 'recent', fetchedAt: at, observedAt: rec.epoch, lastGoodAt: at, stale: false, ttlSeconds: 7200, attribution: [{ text: 'CelesTrak (e2e fixture)' }] },
    providers: { celestrak: { ok: true, count: 1, ms: 0, age_s: 0 } },
  };
  // context.route: the tle-propagate worker fetches the catalogue itself.
  await page.context().route(/\/api\/satellites(\?[^/]*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }));
}

async function boot(page: Page, proj: 'mercator' | 'globe', camera: { lat: number; lng: number; zoom: number }): Promise<void> {
  await gotoMap(page, { camera, params: { proj, layers: 'satellites' } });
  await expect(page.locator('[data-testid="map-root"]')).toHaveAttribute('data-projection', proj, { timeout: 30_000 });
  await waitForMapIdle(page);
  await expect(page.getByTestId('space-status')).toHaveAttribute('data-frame', /"count":1,/, { timeout: 90_000 });
  await waitForCameraIdle(page);
  await waitForAdmissionDrained(page);
}

/** The cursor readout (lat, lng) with the pointer at (x, y). */
async function readoutAt(page: Page, x: number, y: number): Promise<{ lat: number; lng: number }> {
  await page.mouse.move(x, y);
  const el = page.getByTestId('cursor-readout').locator('span').first();
  let parsed: { lat: number; lng: number } | null = null;
  await expect
    .poll(async () => {
      const m = /([\d.]+)°([NS]) ([\d.]+)°([EW])/.exec((await el.textContent()) ?? '');
      parsed = m ? { lat: Number(m[1]) * (m[2] === 'S' ? -1 : 1), lng: Number(m[3]) * (m[4] === 'W' ? -1 : 1) } : null;
      return parsed;
    })
    .not.toBeNull();
  await page.waitForTimeout(150); // let the readout catch up with the last move
  const m = /([\d.]+)°([NS]) ([\d.]+)°([EW])/.exec((await el.textContent()) ?? '')!;
  return { lat: Number(m[1]) * (m[2] === 'S' ? -1 : 1), lng: Number(m[3]) * (m[4] === 'W' ? -1 : 1) };
}

/** Screen point whose readout is (lat, lng): Newton steps on a finite-difference Jacobian. */
async function groundPoint(page: Page, lat: number, lng: number, start: { x: number; y: number }): Promise<{ x: number; y: number }> {
  let { x, y } = start;
  const h = 12;
  for (let i = 0; i < 4; i++) {
    const p = await readoutAt(page, x, y);
    const px = await readoutAt(page, x + h, y);
    const py = await readoutAt(page, x, y + h);
    const [a, b, c, d] = [(px.lng - p.lng) / h, (py.lng - p.lng) / h, (px.lat - p.lat) / h, (py.lat - p.lat) / h];
    const det = a * d - b * c;
    const [el, ea] = [lng - p.lng, lat - p.lat];
    x += (d * el - b * ea) / det;
    y += (-c * el + a * ea) / det;
  }
  return { x, y };
}

/**
 * Centre of the satellite's marker on screen (pixels of its mission colour, see below) within
 * 320 px of `near` (the HUD rail and legends share the mission colours), or null.
 */
async function drawnMarker(page: Page, token: string, near: { x: number; y: number }): Promise<{ x: number; y: number; n: number } | null> {
  const rgb = await tokenRgb(page, token);
  const img = decodePng(await page.screenshot());
  const hits: { x: number; y: number }[] = [];
  const R = 320;
  for (let y = Math.max(0, Math.round(near.y - R)); y < Math.min(img.height, near.y + R); y++) {
    for (let x = Math.max(0, Math.round(near.x - R)); x < Math.min(img.width, near.x + R); x++) {
      const p = (y * img.width + x) * img.channels;
      // The mission colour at 60–105 % brightness (the globe pass darkens it ~15 %), hue held within ±20.
      const [r, g, b] = [img.data[p]!, img.data[p + 1]!, img.data[p + 2]!];
      const k = (r * rgb[0]! + g * rgb[1]! + b * rgb[2]!) / (rgb[0]! ** 2 + rgb[1]! ** 2 + rgb[2]! ** 2);
      if (k >= 0.6 && k <= 1.05 && Math.hypot(r - k * rgb[0]!, g - k * rgb[1]!, b - k * rgb[2]!) <= 20) hits.push({ x, y });
    }
  }
  if (hits.length < 3) return null;
  // The densest 16 px cell (other UI may share the colour, e.g. a rail swatch).
  const cells = new Map<string, { x: number; y: number }[]>();
  for (const h of hits) {
    const k = `${Math.floor(h.x / 16)},${Math.floor(h.y / 16)}`;
    cells.set(k, [...(cells.get(k) ?? []), h]);
  }
  const best = [...cells.values()].sort((a, b) => b.length - a.length)[0]!;
  const cx = best.reduce((s, h) => s + h.x, 0) / best.length;
  const cy = best.reduce((s, h) => s + h.y, 0) / best.length;
  const blob = hits.filter((h) => Math.hypot(h.x - cx, h.y - cy) <= 12);
  return { x: blob.reduce((s, h) => s + h.x, 0) / blob.length, y: blob.reduce((s, h) => s + h.y, 0) / blob.length, n: blob.length };
}

const card = (page: Page) => page.getByTestId('satellite-card').first();

/** Click at (x, y) and report the NORAD id of the card that opens within `ms`, or null. */
async function clickOpens(page: Page, p: { x: number; y: number }, ms = 3_500): Promise<number | null> {
  await page.getByRole('button', { name: 'Close card' }).first().click({ timeout: 1_000 }).catch(() => undefined);
  await expect(card(page)).toBeHidden({ timeout: 5_000 });
  await page.mouse.click(p.x, p.y);
  const shown = await card(page)
    .waitFor({ state: 'visible', timeout: ms })
    .then(() => true, () => false);
  if (!shown) return null;
  return Number((await card(page).locator('dt', { hasText: /^NORAD ID$/ }).locator('xpath=following-sibling::dd[1]').innerText()).trim());
}

test.describe('r10 MAJOR 1: satellites are hit where they are drawn, never at a bare ground point', () => {
  test.describe.configure({ timeout: 300_000 });

  test('mercator z5 and z7: the GEO marker is drawn on its ground point and opens there; bare map beside it opens nothing', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'desktop pixel + pick check');
    const t = pickTarget();
    await serveCatalogue(page, t.rec);
    const token = CATEGORY_TOKEN[t.rec.category];
    for (const zoom of [5, 7]) {
      await boot(page, 'mercator', { lat: t.lat + 1, lng: t.lng, zoom });
      const vp = page.viewportSize()!;
      const ground = await groundPoint(page, t.lat, t.lng, { x: vp.width / 2, y: vp.height / 2 + 100 });
      await page.mouse.move(5, vp.height / 2); // off the marker before the screenshot
      const drawn = await drawnMarker(page, token, ground);
      test.info().annotations.push({ type: `mercator z${zoom}`, description: JSON.stringify({ norad: t.rec.noradId, ground, drawn }) });
      // Before the fix: drawn ~120 px south of the ground point at z5, not drawn at all at z7.
      expect(drawn, `marker drawn at z${zoom}`).not.toBeNull();
      expect(Math.hypot(drawn!.x - ground.x, drawn!.y - ground.y)).toBeLessThanOrEqual(4);
      expect(await clickOpens(page, drawn!)).toBe(t.rec.noradId);
      // 120 px south (where the raised marker used to be drawn at z5): bare map, no card.
      expect(await clickOpens(page, { x: ground.x, y: ground.y + 120 })).toBeNull();
    }
  });

  test('globe z5: a click on the bare ground point under the raised GEO marker opens nothing; a click on the marker opens it', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'desktop pixel + pick check');
    const t = pickTarget();
    await serveCatalogue(page, t.rec);
    // Centred 3° north of the sub-satellite point (the round-10 repro): the marker is lifted south.
    await boot(page, 'globe', { lat: t.lat + 3, lng: t.lng, zoom: 5 });
    const vp = page.viewportSize()!;
    const ground = await groundPoint(page, t.lat, t.lng, { x: vp.width / 2, y: vp.height / 2 + 100 });
    await page.mouse.move(5, vp.height / 2);
    const drawn = await drawnMarker(page, CATEGORY_TOKEN[t.rec.category], ground);
    test.info().annotations.push({ type: 'globe z5', description: JSON.stringify({ norad: t.rec.noradId, ground, drawn }) });
    expect(drawn, 'marker drawn on the globe').not.toBeNull();
    const offset = Math.hypot(drawn!.x - ground.x, drawn!.y - ground.y);
    expect(offset, 'the raised marker is clearly off its ground point').toBeGreaterThan(3 * HIT_PX);
    expect(await clickOpens(page, ground)).toBeNull();
    expect(await clickOpens(page, drawn!)).toBe(t.rec.noradId);
  });
});
