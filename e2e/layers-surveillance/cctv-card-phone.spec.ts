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

  /**
   * r9: the sticky footer reaches the tabpanel's real bottom edge, so no scrolled body row shows
   * through a strip below it (sticky insets resolve against the scroll container's content box; the
   * tabpanel's py-3 used to leave 12 px). Upstream-free: /api/cctv is answered with one fixture camera
   * (Toronto, a proxied JPG provider, so it gets a preview tile) and the still with a 1x1 JPEG.
   */
  test('the sticky footer covers the scrollport bottom edge while the card body is scrolled', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'phone layout only (390x844)');
    test.setTimeout(120_000);
    const [lat, lng] = [43.65107, -79.347015];
    const fields = ['id', 'lat', 'lng', 'name', 'providerId', 'city', 'country', 'streamType', 'stillUrl', 'streamUrl', 'externalUrl', 'observedAt', 'source'];
    const now = new Date().toISOString();
    await page.route(/\/api\/cctv\?region=/, (route) => {
      const region = new URL(route.request().url()).searchParams.get('region');
      const rows = region === 'canada' ? [['toronto-fixture-1', lat, lng, 'Fixture camera, Front St at Parliament St', 'toronto', 'Toronto', 'CA', 'jpg', 'https://opendata.toronto.ca/transportation/tmc/rescucameraimages/CameraImages/loc1.jpg', null, null, null, 'toronto']] : [];
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          fields,
          rows,
          regions: [region],
          pendingRegions: [],
          counts: { [String(region)]: rows.length },
          meta: { feed: 'cctv', kind: 'live', state: 'live', fetchedAt: now, observedAt: null, lastGoodAt: now, stale: false, ttlSeconds: 1800, attribution: [] },
          providers: rows.length ? { toronto: { ok: true, count: 1, ms: 1, age_s: 0 } } : {},
        }),
      });
    });
    const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
    await page.route(/\/api\/cctv\/proxy\?/, (route) => route.fulfill({ status: 200, contentType: 'image/jpeg', body: jpeg }));
    await page.goto(`/?c=${lat.toFixed(5)},${lng.toFixed(5)},14&layers=cctv,cctv_previews`);
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });
    const tile = page.getByTestId('cctv-previews').getByRole('button').first();
    await expect(tile).toBeVisible({ timeout: 60_000 });
    await tile.click();
    const card = page.getByTestId('camera-card');
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByTestId('camera-operator')).not.toBeEmpty({ timeout: 15_000 });
    const footer = card.getByTestId('camera-card-footer');
    const panel = page.getByRole('tabpanel').filter({ has: card });
    // The body must overflow for the footer to be stuck at all; scroll it part-way.
    const overflow = await panel.evaluate((el) => {
      el.scrollTop = Math.floor((el.scrollHeight - el.clientHeight) / 2);
      return el.scrollHeight - el.clientHeight;
    });
    expect(overflow, 'card body overflows its scroll container').toBeGreaterThan(24);
    for (const at of ['mid-scroll', 'top', 'end']) {
      if (at === 'top') await panel.evaluate((el) => void (el.scrollTop = 0));
      if (at === 'end') await panel.evaluate((el) => void (el.scrollTop = el.scrollHeight));
      const f = await footer.evaluate((el) => el.getBoundingClientRect().bottom);
      const p = await panel.evaluate((el) => el.getBoundingClientRect().bottom);
      expect(f, `footer bottom reaches the tabpanel bottom (${at})`).toBeGreaterThanOrEqual(p - 1);
      expect(f, `footer stays inside the tabpanel (${at})`).toBeLessThanOrEqual(p + 1);
    }
  });
});
