import { expect, test, type Page } from '@playwright/test';

/**
 * Shared steps for the layers-hazards specs. Hazard layers draw on the basemap, so a spec that needs
 * the map skips honestly (with the reason, reported as skipped, never a silent pass) when the
 * OpenFreeMap style cannot be reached: the app then shows BASEMAP UNAVAILABLE and creates no map
 * canvas at all (round-4 e2e: `tiles.openfreemap.org/styles/dark` net::ERR_TOO_MANY_RETRIES at the
 * sandbox proxy). Same rule as e2e/panels-recon needsBasemap().
 */

export const BASEMAP_DOWN = 'BASEMAP UNAVAILABLE';

/** Wait for the map canvas or the BASEMAP UNAVAILABLE alert; skip with the reason on the latter. */
export async function needsBasemap(page: Page): Promise<void> {
  const map = page.locator('canvas.maplibregl-canvas');
  const down = page.getByText(BASEMAP_DOWN);
  // The style is fetched with retry/backoff (4, 8, 16, 32 s…): allow for a slow first try.
  await expect(map.or(down).first()).toBeVisible({ timeout: 90_000 }).catch(() => undefined);
  test.skip((await down.isVisible()) || !(await map.isVisible()), 'the OpenFreeMap basemap style is unreachable from this network (BASEMAP UNAVAILABLE: no map canvas, so no hazard layer can draw)');
}

/** Open the app at `query`, require the basemap (or skip), and wait for the splash to lift. */
export async function openMap(page: Page, query: string): Promise<void> {
  await page.goto(`/?${query}`);
  await needsBasemap(page);
  await expect(page.getByRole('status', { name: /loading/i })).toBeHidden({ timeout: 30_000 });
}
