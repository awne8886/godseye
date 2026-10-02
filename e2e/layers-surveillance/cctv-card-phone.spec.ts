import { expect, test } from '@playwright/test';

/**
 * m21 (layers-surveillance): on a 390x844 phone the camera card keeps "Open viewer" and
 * "Report / remove this camera" in view without scrolling (sticky footer), each at least 44 px tall.
 * The card opens from a Live Preview tile (DOM button) at zoom 14 over a live Hong Kong camera; when
 * the asia providers are down the route must answer SOURCE OFFLINE (503) and the check is skipped.
 */
test.describe('camera card on phones', () => {
  test('open-viewer and report/remove are in the viewport and >= 44 px without scrolling', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'phone layout only (390x844)');
    test.setTimeout(150_000);
    const res = await page.request.get('/api/cctv?region=asia', { timeout: 60_000 });
    if (res.status() === 503) {
      expect((await res.json()).error).toBe('source_offline');
      test.skip(true, 'asia camera providers offline right now: SOURCE OFFLINE (asserted)');
    }
    expect(res.ok()).toBe(true);
    const cat = (await res.json()) as { fields: string[]; rows: (string | number | null)[][] };
    const f = (k: string) => cat.fields.indexOf(k);
    const row = cat.rows.find((r) => r[f('providerId')] === 'hktd' && r[f('stillUrl')]);
    test.skip(!row, 'no Hong Kong camera with a still listed right now');
    const [lat, lng] = [Number(row![f('lat')]), Number(row![f('lng')])];
    await page.goto(`/?c=${lat.toFixed(5)},${lng.toFixed(5)},14&layers=cctv,cctv_previews`);
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });
    const tile = page.getByTestId('cctv-previews').getByRole('button').first();
    await expect(tile).toBeVisible({ timeout: 60_000 });
    await tile.click();
    const card = page.getByTestId('camera-card');
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByTestId('camera-operator')).not.toBeEmpty({ timeout: 15_000 });
    for (const id of ['camera-open-viewer', 'camera-report']) {
      const el = card.getByTestId(id);
      // As rendered: no scrollIntoView and no scrolling of the card.
      await expect(el, id).toBeInViewport({ ratio: 1 });
      const box = (await el.boundingBox())!;
      expect(box.height, id).toBeGreaterThanOrEqual(44);
      expect(box.y + box.height, id).toBeLessThanOrEqual(844);
    }
  });
});
