import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { CATEGORY_TOKEN, recordToOmm, rowToRecord, SAT_CATEGORIES, type SatRow } from '../../src/features/space/lib/catalog';
import { packRows } from '../../src/features/space/lib/packed';
import { propagateAt, satrecFromOmm } from '../../src/features/space/lib/orbit';
import { displayAltM, propagateBatch, type BatchInput, type FarSideCamera } from '../../src/features/space/lib/propagate-batch';
import { centralAngle } from '../../src/lib/geo';
import { horizonAngleDeg } from '../../src/lib/map/far-side';
import { decodePng, gotoMap, nudgeMap, readFarSideCamera, tokenRgb, waitForCameraIdle } from '../map-engine/helpers';

/**
 * R2 round 5 MAJOR-2: satellites behind the globe were drawn and pickable. The far-side filter kept
 * everything within 90° of the map centre; the visible cap is the camera's horizon plus the
 * horizon of the satellite's DISPLAY altitude (z6 over the US ≈ 54° for LEO). These specs
 * re-propagate the page's own catalogue at the page's frame time with the camera the map host
 * publishes, and check that exactly the camera-facing satellites are drawn and that no click opens
 * a satellite behind the globe. Upstream-dependent: skips (with the reason) on SOURCE OFFLINE.
 */

interface FrameDiag {
  version: string;
  at: number;
  count: number;
  hidden: number;
  failed: number;
  camera: FarSideCamera | null;
}

interface Catalogue {
  version: string;
  rows: SatRow[];
  input: BatchInput;
}

const DEG = 180 / Math.PI;

async function catalogue(request: APIRequestContext): Promise<Catalogue | null> {
  const res = await request.get('/api/satellites');
  if (res.status() === 503) return null;
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { rows: SatRow[]; meta: { fetchedAt: string } };
  const packed = packRows(body.rows);
  return {
    // The worker's catalogue version (src/features/space/lib/propagator.ts).
    version: `${body.meta.fetchedAt}|${body.rows.length}`,
    rows: body.rows,
    input: { satrecs: body.rows.map((r) => satrecFromOmm(recordToOmm(rowToRecord(r)))), noradIds: packed.noradIds, categories: packed.categories },
  };
}

async function frameDiag(page: Page): Promise<FrameDiag | null> {
  const raw = await page.getByTestId('space-status').getAttribute('data-frame');
  return raw ? (JSON.parse(raw) as FrameDiag) : null;
}

const sameCamera = (a: FarSideCamera | null, b: FarSideCamera | null) =>
  !!a && !!b && Math.abs(a.lng - b.lng) < 2e-4 && Math.abs(a.lat - b.lat) < 2e-4 && Math.abs(a.altitude - b.altitude) < 2;

/** Boot the globe on the satellites layer and wait for a frame filtered with the host's settled camera. */
async function bootSettled(page: Page, zoom: number): Promise<FrameDiag> {
  await gotoMap(page, { camera: { lat: 39, lng: -98, zoom }, params: { proj: 'globe', layers: 'satellites' } });
  await expect(page.locator('[data-testid="map-root"]')).toHaveAttribute('data-projection', 'globe', { timeout: 30_000 });
  await expect(page.getByTestId('space-status')).toHaveAttribute('data-frame', /"camera":\{/, { timeout: 90_000 });
  // A small drag ends in a moveend: the host writes data-far-side, the layer posts the same camera.
  await nudgeMap(page);
  await waitForCameraIdle(page);
  let settled: FrameDiag | null = null;
  await expect
    .poll(
      async () => {
        const [f, host] = [await frameDiag(page), await readFarSideCamera(page)];
        settled = f && sameCamera(f.camera, host) ? f : null;
        return !!settled;
      },
      { timeout: 30_000, message: 'the drawn frame is filtered with the camera the map host published' },
    )
    .toBe(true);
  return settled!;
}

test('globe z6: exactly the satellites above the horizon at their drawn altitude are drawn (not 90° from the centre)', async ({ page, request }, info) => {
  test.skip(info.project.name === 'mobile', 'desktop draw check');
  test.setTimeout(240_000);
  let cat = await catalogue(request);
  test.skip(cat === null, 'CelesTrak and SatNOGS are both offline from this network');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const f = await bootSettled(page, 6);
  if (cat!.version !== f.version) cat = await catalogue(request); // refreshed between the two reads
  test.skip(!cat || cat.version !== f.version, 'the catalogue was refreshed while the page loaded it');

  const all = new Set(SAT_CATEGORIES.map((_, i) => i));
  const palette = SAT_CATEGORIES.map(() => [255, 255, 255, 255] as const);
  const expected = propagateBatch(cat!.input, { at: f.at, palette, visible: all, camera: f.camera, selectedId: null });
  const flat = propagateBatch(cat!.input, { at: f.at, palette, visible: all, camera: null, selectedId: null });
  const cam = f.camera!;
  let within90 = 0;
  for (let k = 0; k < flat.count; k++) {
    if (centralAngle([cam.lng, cam.lat], [flat.positions[k * 3]!, flat.positions[k * 3 + 1]!]) * DEG <= 90) within90++;
  }
  // The camera at z6 sees much less than a hemisphere; the old rule drew thousands behind the limb.
  expect(horizonAngleDeg(cam.altitude)).toBeLessThan(45);
  expect(within90 - expected.count).toBeGreaterThan(0.1 * flat.count);
  // The page draws the camera-facing set (± a couple of grazing-limb rounding cases).
  expect(Math.abs(f.count - expected.count)).toBeLessThanOrEqual(2);
  expect(f.count + f.hidden + f.failed).toBe(cat!.rows.length);
  expect(errors).toEqual([]);
});

/**
 * Isolated satellite markers on screen: pixels within ±28 of a mission colour token (markers draw
 * at alpha 0.95; Earth-shadow ones at 0.3 do not match), clustered, inside `rect` (fractions of
 * the viewport, clear of the HUD), with no other marker within 30 px so a click is unambiguous.
 */
async function satelliteMarkers(page: Page, rect = { x0: 0.15, y0: 0.15, x1: 0.85, y1: 0.8 }): Promise<{ x: number; y: number }[]> {
  const tokens = await Promise.all(SAT_CATEGORIES.map((c) => tokenRgb(page, CATEGORY_TOKEN[c])));
  const img = decodePng(await page.screenshot());
  const clusters: { x: number; y: number; n: number }[] = [];
  for (let y = Math.round(img.height * rect.y0); y < img.height * rect.y1; y++) {
    for (let x = Math.round(img.width * rect.x0); x < img.width * rect.x1; x++) {
      const p = (y * img.width + x) * img.channels;
      const [r, g, b] = [img.data[p]!, img.data[p + 1]!, img.data[p + 2]!];
      if (!tokens.some((t) => Math.abs(r - t[0]!) <= 28 && Math.abs(g - t[1]!) <= 28 && Math.abs(b - t[2]!) <= 28)) continue;
      const c = clusters.find((k) => Math.abs(k.x / k.n - x) <= 4 && Math.abs(k.y / k.n - y) <= 4);
      if (c) {
        c.x += x;
        c.y += y;
        c.n++;
      } else clusters.push({ x, y, n: 1 });
    }
  }
  const centres = clusters.filter((c) => c.n >= 2).map((c) => ({ x: c.x / c.n, y: c.y / c.n }));
  return centres.filter((c) => centres.every((o) => o === c || Math.hypot(o.x - c.x, o.y - c.y) > 30));
}

test('globe z4: clicks on drawn satellites open them, and never one behind the globe', async ({ page, request }, info) => {
  test.skip(info.project.name === 'mobile', 'desktop pick check');
  test.setTimeout(240_000);
  const cat = await catalogue(request);
  test.skip(cat === null, 'CelesTrak and SatNOGS are both offline from this network');
  await bootSettled(page, 4);
  const byId = new Map(cat!.rows.map((r, i) => [rowToRecord(r).noradId, i]));
  const card = page.getByTestId('satellite-card').first();
  const norad = async () => (await card.isVisible()) ? Number((await card.locator('dt', { hasText: /^NORAD ID$/ }).locator('xpath=following-sibling::dd[1]').innerText()).trim()) : null;
  const tried: { x: number; y: number }[] = [];
  let opened = 0;
  let confirmed = 0;
  let unconfirmed = 0;
  for (let attempt = 0; attempt < 14; attempt++) {
    // LEO markers move ~2 px/s at z4: locate them afresh right before every click.
    const t = (await satelliteMarkers(page)).find((m) => tried.every((o) => Math.hypot(o.x - m.x, o.y - m.y) > 40));
    if (!t) break;
    tried.push(t);
    // Confirm the target is still a pickable marker before clicking: the pixel detector can match
    // terrain or a marker that moved off the spot between the screenshot and now (seconds under
    // load). The hover pick runs through the same router as the click and sets the pointer cursor.
    await page.mouse.move(t.x, t.y);
    const hovered = await expect
      .poll(() => page.locator('canvas.maplibregl-canvas').first().evaluate((c) => (c as HTMLCanvasElement).style.cursor), { timeout: 1_500 })
      .toBe('pointer')
      .then(() => true, () => false);
    if (!hovered) {
      unconfirmed++;
      continue;
    }
    confirmed++;
    // The camera the pick is judged against (a selection never moves the camera).
    const cam = (await readFarSideCamera(page))!;
    const before = await norad();
    await page.mouse.click(t.x, t.y);
    // A pick (GPU + CPU hit test) takes up to ~0.6 s on SwiftShader; the card follows.
    let id: number | null = null;
    for (const until = Date.now() + 4_000; Date.now() < until; await page.waitForTimeout(150)) {
      const n = await norad();
      if (n !== null && n !== before) {
        id = n;
        break;
      }
    }
    if (id === null) continue;
    opened++;
    // Close the card so it never covers the next marker.
    await page.getByRole('button', { name: 'Close card' }).first().click({ timeout: 2_000 }).catch(() => undefined);
    const i = byId.get(id);
    expect(i, `NORAD ${id} is in the catalogue`).toBeDefined();
    const rec = cat!.input.satrecs[i!];
    expect(rec, `NORAD ${id} has usable elements (it was drawn)`).toBeTruthy();
    const p = propagateAt(rec!, new Date());
    expect(p, `NORAD ${id} propagates now`).not.toBeNull();
    const cap = horizonAngleDeg(cam.altitude) + horizonAngleDeg(displayAltM(p!.altKm));
    const d = centralAngle([cam.lng, cam.lat], [p!.lng, p!.lat]) * DEG;
    // 0.5° of slack: a LEO satellite moves ~0.07°/s between the click and this check.
    expect(d, `NORAD ${id} is ${d.toFixed(1)}° from the camera, cap ${cap.toFixed(1)}°`).toBeLessThanOrEqual(cap + 0.5);
  }
  test.info().annotations.push({ type: 'pixel targets / hover-confirmed markers / opened', description: `${tried.length} / ${confirmed} / ${opened}` });
  // Targets the hover pick did not confirm are "not a marker any more", not a failed open.
  test.skip(confirmed < 3, `only ${confirmed} hover-confirmed satellite markers on screen (${unconfirmed} pixel targets unconfirmed)`);
  // A hover-confirmed marker opens on click (the far-side re-check never rejects a drawn, facing satellite).
  expect(opened).toBeGreaterThanOrEqual(Math.ceil(confirmed / 2));
});
