import { expect, test } from '@playwright/test';
import { gotoMap, waitForAdmissionDrained, waitForMapStyle } from './helpers';

/** Phase 3 round-1 regressions owned by map-engine (R1-B1/B1b attribution, R1-M1 right-click pair). */
test.describe('map engine · round-1 regressions', () => {
  test.describe.configure({ timeout: 240_000 });

  test('R1-B1: the attribution control is not covered by the status bar / mobile nav', async ({ page }) => {
    await gotoMap(page);
    await waitForMapStyle(page);
    const attrib = page.locator('.maplibregl-ctrl-attrib');
    await expect(attrib).toContainText('OpenStreetMap');
    await expect(attrib).toBeVisible();
    const covered = await attrib.evaluate((a) => {
      const r = a.getBoundingClientRect();
      return [0.1, 0.5, 0.9]
        .map((f) => document.elementFromPoint(r.x + r.width * f, r.y + r.height / 2))
        .filter((el) => !el || !a.contains(el))
        .map((el) => (el ? `${el.tagName}.${el.className}`.slice(0, 80) : 'null (off-screen)'));
    });
    expect(covered).toEqual([]);
  });

  test('R1-B1b: bottom-right MapLibre controls sit above the FX overlay (z ≥ 5)', async ({ page }) => {
    await gotoMap(page);
    await waitForMapStyle(page);
    const z = await page.locator('.maplibregl-ctrl-bottom-right').evaluate((el) => Number(getComputedStyle(el).zIndex));
    expect(z).toBeGreaterThanOrEqual(5);
  });

  test('R1-M1: a double right-click (< 500 ms) is dispatched promptly and opens the Region Dossier', async ({ page, isMobile }) => {
    test.skip(isMobile, 'right-click is a desktop gesture (touch uses long-press)');
    await page.addInitScript(() => {
      const w = window as unknown as { __cm: number[] };
      w.__cm = [];
      window.addEventListener('contextmenu', (e) => w.__cm.push(e.timeStamp), true);
    });
    await gotoMap(page, { camera: { lat: 48.85, lng: 2.35, zoom: 6 } });
    await waitForMapStyle(page);
    // Let the default data layers publish and their GPU start-up drain (R1r5-m3): a shader link
    // (1.7–7.5 s on SwiftShader) landing between the two clicks would stretch the pair.
    await waitForAdmissionDrained(page);
    const box = (await page.locator('canvas.maplibregl-canvas').boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    // The pointer arrives first (its hover pick runs now, not inside the pair).
    await page.mouse.move(x, y);
    await page.waitForTimeout(1000);
    await page.mouse.click(x, y, { button: 'right' });
    await page.mouse.click(x + 4, y + 2, { button: 'right' });
    const [a, b] = await page.evaluate(() => (window as unknown as { __cm: number[] }).__cm.slice(-2));
    // The dispatch gap (event timestamps, as the product's detector reads them) stays < 500 ms.
    expect(b! - a!).toBeLessThan(500);
    await expect(page).toHaveURL(/dossier=4[6-9]\.\d+(%2C|,)[0-4]\.\d+/, { timeout: 10_000 });
  });
});
