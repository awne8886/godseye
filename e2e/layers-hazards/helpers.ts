import { expect, test, type Page } from '@playwright/test';

/**
 * Shared steps for the layers-hazards specs. Hazard layers draw on the basemap, so a spec that needs
 * the map skips honestly (with the reason, reported as skipped, never a silent pass) when the
 * OpenFreeMap style cannot be reached: the app then shows BASEMAP UNAVAILABLE and creates no map
 * canvas at all (round-4 e2e: `tiles.openfreemap.org/styles/dark` net::ERR_TOO_MANY_RETRIES at the
 * sandbox proxy). Same rule as e2e/panels-recon needsBasemap(), except that the app's own style
 * retries (MapView: 4, 8, 16, 32 s…) are waited out first, since the alert shows from the first
 * failed try and a later try often succeeds. No canvas and no alert is a failure, not a skip.
 */

export const BASEMAP_DOWN = 'BASEMAP UNAVAILABLE';

/** Long enough for the style's first try plus the 4 + 8 + 16 + 32 s retries. */
const BASEMAP_WAIT_MS = 100_000;

/** Wait for the map canvas (through the style retries); skip with the reason if the basemap stays down. */
export async function needsBasemap(page: Page, timeout = BASEMAP_WAIT_MS): Promise<void> {
  const map = page.locator('canvas.maplibregl-canvas');
  const drawn = await map.waitFor({ state: 'visible', timeout }).then(
    () => true,
    () => false,
  );
  if (drawn) return;
  test.skip(await page.getByText(BASEMAP_DOWN).isVisible(), `the OpenFreeMap basemap style is unreachable from this network (BASEMAP UNAVAILABLE for ${timeout / 1000} s, through the app's retries: no map canvas, so no hazard layer can draw)`);
  await expect(map, 'no map canvas and no BASEMAP UNAVAILABLE alert').toBeVisible({ timeout: 1 });
}

/** Open the app at `query`, require the basemap (or skip), and wait for the splash to lift. */
export async function openMap(page: Page, query: string): Promise<void> {
  await page.goto(`/?${query}`);
  await needsBasemap(page);
  await expect(page.getByRole('status', { name: /loading/i })).toBeHidden({ timeout: 30_000 });
}
