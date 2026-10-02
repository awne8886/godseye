import { expect, test } from '@playwright/test';
import { MAP } from './helpers';

/** Phase 3 round 4 map-engine regressions (R1r3-M1 hung tile, R1r4-m1 hung style). */
test.describe('map-engine round 4', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop');

  test('R1r3-M1: the map is ready while every basemap tile hangs (ready = style parsed, not tiles)', async ({ page }) => {
    test.setTimeout(150_000);
    let held = 0;
    // Never answered: `load`/`idle` cannot fire, isStyleLoaded() stays false.
    await page.route(/tiles\.openfreemap\.org\/planet\/.+\.pbf/, () => void held++);
    await page.goto('/?layers=&c=48.85,2.35,5');
    await expect(page.locator(MAP)).toHaveAttribute('data-style-ready', 'true', { timeout: 90_000 });
    await expect(page.locator(MAP)).toHaveAttribute('data-map-ready', 'true', { timeout: 15_000 });
    await expect.poll(() => held, { timeout: 30_000 }).toBeGreaterThan(0);
    // Honest about the tiles: after the stall window the chip says the basemap is still loading.
    await expect(page.getByText(/BASEMAP LOADING/)).toBeVisible({ timeout: 30_000 });
  });

  test('R1r4-m1: a style request that never answers shows BASEMAP UNAVAILABLE, then retries', async ({ page }) => {
    test.setTimeout(120_000);
    let styleRequests = 0;
    await page.route(/tiles\.openfreemap\.org\/styles\/dark/, () => void styleRequests++);
    await page.goto('/?layers=');
    // 15 s deadline per request, first retry 2 s later: the alert is up well before 30 s.
    await expect(page.getByText('BASEMAP UNAVAILABLE')).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => styleRequests, { timeout: 40_000 }).toBeGreaterThan(1);
  });
});
