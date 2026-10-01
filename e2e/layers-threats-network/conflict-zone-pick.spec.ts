/**
 * R3-M3: clicking (desktop) or tapping (phone) a conflict-zone polygon opens the conflict-zone card
 * with its REFERENCE badge. The zone is a native MapLibre fill (`tn-zones-fill`) resolved by the
 * map's single click router (registerNativePick). Ukraine is a curated reference polygon, so the
 * camera centre 48.558,31.377 is always inside a drawn zone.
 */
import { expect, test } from '@playwright/test';
import { gotoMap, MAP, waitForMapStyle } from '../map-engine/helpers';

test('a conflict-zone polygon opens its card with REFERENCE', async ({ page, isMobile }) => {
  test.setTimeout(150_000);
  await gotoMap(page, { camera: { lat: 48.558, lng: 31.377, zoom: 5 }, params: { layers: 'conflict_zones' } });
  await waitForMapStyle(page);
  // The header counts the zones only once they are drawn.
  await expect(page.getByRole('group', { name: 'Telemetry' })).toContainText(/[1-9]\d* ENTITIES/, { timeout: 90_000 });
  const box = (await page.locator(`${MAP} canvas.maplibregl-canvas`).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const card = page.getByTestId('card-conflict-zone');
  // The GeoJSON tile may still be on its way to the renderer right after the count: click again
  // until the polygon answers (each click is one real pick through the map's click router).
  await expect(async () => {
    if (isMobile) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
    await expect(card).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 45_000 });
  await expect(card.getByTestId('card-reference')).toHaveText('REFERENCE');
});
