import { expect, test } from '@playwright/test';
import { gotoMap, MAP, waitForAdmissionDrained, waitForCameraIdle, waitForMapStyle } from './helpers';

/** Phase 3 verification round 8, map-engine findings. */
test.describe('map engine · round-8 regressions', () => {
  test.describe.configure({ timeout: 420_000 });

  test('m: after disarming DRAW (fires on) a double right-click opens the Region Dossier, 5 times in a row', async ({ page, isMobile }) => {
    test.skip(isMobile, 'right-click is a desktop gesture (touch uses long-press)');
    await gotoMap(page, { camera: { lat: 20, lng: 0, zoom: 3 }, params: { proj: 'mercator', layers: 'earthquakes,fires' } });
    await waitForMapStyle(page);
    // No shader link may land between the two clicks of a pair (helpers.ts, R1r5-m3).
    await waitForAdmissionDrained(page);
    const map = page.locator(MAP);
    const box = (await page.locator('canvas.maplibregl-canvas').boundingBox())!;
    const panel = page.getByTestId('draw-panel');
    for (let i = 0; i < 5; i++) {
      // Arm DRAW (Line), then stop drawing: the map tool is disarmed.
      await page.getByRole('button', { name: 'DRAW', exact: true }).click();
      await expect(page).not.toHaveURL(/dossier=/);
      await panel.getByRole('button', { name: /Line/ }).click();
      await expect(map).toHaveAttribute('data-map-tool', 'draw', { timeout: 30_000 });
      await panel.getByRole('button', { name: 'Stop drawing' }).click();
      await expect(map).not.toHaveAttribute('data-map-tool', 'draw');
      await waitForCameraIdle(page);
      const x = box.x + box.width / 2 - 200 + i * 15;
      const y = box.y + box.height / 2 + i * 10;
      await page.mouse.move(x, y);
      await page.waitForTimeout(800);
      await page.mouse.click(x, y, { button: 'right' });
      await page.mouse.click(x + 3, y + 2, { button: 'right' });
      await expect(page, `pair ${i + 1} of 5`).toHaveURL(/dossier=-?\d+\.\d+(%2C|,)-?\d+\.\d+/, { timeout: 10_000 });
    }
  });

  test('m: a right-drag (rotate) is not a right-click; no browser menu on the map', async ({ page, isMobile }) => {
    test.skip(isMobile, 'right-click is a desktop gesture (touch uses long-press)');
    await gotoMap(page, { camera: { lat: 20, lng: 0, zoom: 3 }, params: { layers: '' } });
    await waitForMapStyle(page);
    await waitForCameraIdle(page);
    const box = (await page.locator('canvas.maplibregl-canvas').boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const prevented = await page.evaluate(() => {
      const w = window as unknown as { __cmPrevented: boolean[] };
      w.__cmPrevented = [];
      window.addEventListener('contextmenu', (e) => setTimeout(() => w.__cmPrevented.push(e.defaultPrevented)), true);
      return true;
    });
    expect(prevented).toBe(true);
    // A short right-drag, then a right-click where the drag started: not a pair.
    await page.mouse.move(x, y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(x + 60, y, { steps: 6 });
    await page.mouse.up({ button: 'right' });
    await page.mouse.click(x, y, { button: 'right' });
    await page.waitForTimeout(1500);
    expect(page.url()).not.toContain('dossier=');
    expect(await page.evaluate(() => (window as unknown as { __cmPrevented: boolean[] }).__cmPrevented)).not.toContain(false);
  });

  test('M: hovering runs the host hover pick at most ~10 times a second, and once where the pointer rests', async ({ page, isMobile }) => {
    test.skip(isMobile, 'hover is a pointer-device behaviour');
    await gotoMap(page, { camera: { lat: 20, lng: 0, zoom: 2.5 } });
    await waitForMapStyle(page);
    await waitForCameraIdle(page);
    const map = page.locator(MAP);
    const box = (await page.locator('canvas.maplibregl-canvas').boundingBox())!;
    const picks = async () => Number((await map.getAttribute('data-hover-picks')) ?? 0);
    await page.mouse.move(box.x + 300, box.y + 300);
    await page.waitForTimeout(600);
    const before = await picks();
    const t0 = Date.now();
    // ~2 s of continuous movement, one step every ~16 ms.
    for (let i = 0; i < 120; i++) {
      await page.mouse.move(box.x + 300 + i * 4, box.y + 300 + (i % 7) * 3);
      await page.waitForTimeout(16);
    }
    const elapsed = Date.now() - t0;
    const afterSweep = await picks();
    const during = afterSweep - before;
    // One per 100 ms at most (plus the first), never one per frame (120 moves).
    expect(during).toBeLessThanOrEqual(Math.ceil(elapsed / 100) + 1);
    expect(during).toBeGreaterThan(0);
    // The pointer rests: at most one trailing pick at its final position, then none.
    await page.waitForTimeout(1000);
    const rested = await picks();
    expect(rested - afterSweep).toBeLessThanOrEqual(1);
    await page.waitForTimeout(1500);
    expect(await picks()).toBe(rested);
  });
});

test.describe('map engine · round-8 landscape phone imagery chips', () => {
  test.describe.configure({ timeout: 300_000 });
  test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });

  test('M: the imagery chips fold into one summary chip (worst tone) that a tap unfolds', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'phone layout; once');
    await gotoMap(page, { camera: { lat: 20, lng: 0, zoom: 2 }, params: { panel: 'layers', layers: 'day_night,gibs_truecolor,terrain_elevation' } });
    await waitForMapStyle(page);
    const summary = page.getByTestId('imagery-chip-summary');
    await expect(summary).toBeVisible({ timeout: 60_000 });
    // One row in the stack, however many sources are on (night lights, VIIRS true colour, terrain).
    await expect(page.locator('.godseye-imagery-chips li')).toHaveCount(1);
    await expect(summary).toHaveText(/\+[2-9]$/);
    await expect(summary).toHaveAttribute('data-tone', /^(reference|offline)$/);
    const stack = await page.locator('.godseye-imagery-chips').boundingBox();
    expect(stack!.height).toBeLessThanOrEqual(48);
    const toggle = page.locator('.godseye-imagery-chips button');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // 44 px touch target.
    expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await toggle.tap();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    for (const id of ['night', 'gibs', 'terrain']) await expect(page.getByTestId(`imagery-chip-${id}`)).toBeVisible();
    await toggle.tap();
    await expect(page.locator('.godseye-imagery-chips li')).toHaveCount(1);
  });
});
