import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { recordToOmm, rowToRecord, SAT_CATEGORIES, type SatRow } from '../../src/features/space/lib/catalog';
import { packRows } from '../../src/features/space/lib/packed';
import { propagateAt, satrecFromOmm } from '../../src/features/space/lib/orbit';
import { displayAltM, propagateBatch, type BatchInput, type FarSideCamera } from '../../src/features/space/lib/propagate-batch';
import { centralAngle } from '../../src/lib/geo';
import { horizonAngleDeg } from '../../src/lib/map/far-side';
import { collectErrors, gotoMap, MAP, nudgeMap, readFarSideCamera, waitForCameraIdle } from '../map-engine/helpers';

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
  const errors = collectErrors(page);
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

test('globe z4: no click opens a satellite behind the globe', async ({ page, request }, info) => {
  test.skip(info.project.name === 'mobile', 'desktop pick sweep');
  test.setTimeout(240_000);
  const cat = await catalogue(request);
  test.skip(cat === null, 'CelesTrak and SatNOGS are both offline from this network');
  await bootSettled(page, 4);
  const byId = new Map(cat!.rows.map((r, i) => [rowToRecord(r).noradId, i]));
  const box = (await page.locator(`${MAP} canvas.maplibregl-canvas`).boundingBox())!;
  const card = page.getByTestId('satellite-card').first();
  const opened = new Set<number>();
  for (let gy = 0; gy < 4; gy++) {
    for (let gx = 0; gx < 4; gx++) {
      // The central 40 % of the canvas (clear of the HUD rails and panels).
      await page.mouse.click(box.x + box.width * (0.3 + gx * 0.133), box.y + box.height * (0.3 + gy * 0.133));
      await page.waitForTimeout(400);
      if (!(await card.isVisible())) continue;
      const id = Number((await card.locator('dt', { hasText: /^NORAD ID$/ }).locator('xpath=following-sibling::dd[1]').innerText()).trim());
      if (opened.has(id)) continue;
      opened.add(id);
      const cam = (await readFarSideCamera(page))!;
      const i = byId.get(id);
      expect(i, `NORAD ${id} is in the catalogue`).toBeDefined();
      const rec = cat!.input.satrecs[i!];
      expect(rec, `NORAD ${id} has usable elements (it was drawn)`).toBeTruthy();
      const p = propagateAt(rec!, new Date());
      expect(p, `NORAD ${id} propagates now`).not.toBeNull();
      if (!p) continue;
      const cap = horizonAngleDeg(cam.altitude) + horizonAngleDeg(displayAltM(p.altKm));
      const d = centralAngle([cam.lng, cam.lat], [p.lng, p.lat]) * DEG;
      // 0.5° of slack: a LEO satellite moves ~0.07°/s between the click and this check.
      expect(d, `NORAD ${id} is ${d.toFixed(1)}° from the camera, cap ${cap.toFixed(1)}°`).toBeLessThanOrEqual(cap + 0.5);
    }
  }
  test.info().annotations.push({ type: 'satellite cards opened', description: String(opened.size) });
});
