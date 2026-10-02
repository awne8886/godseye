import { expect, test, type Page } from '@playwright/test';

/**
 * CCTV layer (layers-surveillance): cameras render when the operators are live, clicking one opens
 * the camera card and viewer with operator, licence and "Report / remove this camera", and
 * /cameras-notice loads cleanly. Runs against the live /api/cctv; when every provider of a region
 * is down the route must answer SOURCE OFFLINE (503) and the render checks are skipped. A region
 * whose providers all need a key the server lacks is "not configured" (200), never requested by the UI.
 */

type Row = (string | number | null)[];
interface Catalogue {
  fields: string[];
  rows: Row[];
}

async function liveRegion(page: Page, region: string): Promise<Catalogue | null> {
  const res = await page.request.get(`/api/cctv?region=${region}`, { timeout: 60_000 });
  if (res.status() === 503) {
    const body = await res.json();
    expect(body.error).toBe('source_offline');
    return null;
  }
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body.meta.feed).toBe('cctv');
  expect(Object.keys(body.providers).length).toBeGreaterThan(0);
  return body as Catalogue;
}

/** A camera with a still whose nearest neighbour is far enough away to click unambiguously. */
function isolated(cat: Catalogue): { id: string; lat: number; lng: number } | null {
  const f = (k: string) => cat.fields.indexOf(k);
  const cams = cat.rows.filter((r) => r[f('stillUrl')] && r[f('streamType')] !== 'link').map((r) => ({ id: String(r[f('id')]), lat: Number(r[f('lat')]), lng: Number(r[f('lng')]) }));
  for (const c of cams) {
    const near = cams.some((o) => o.id !== c.id && Math.abs(o.lat - c.lat) < 0.01 && Math.abs(o.lng - c.lng) < 0.01);
    if (!near) return c;
  }
  return null;
}

test.describe('cctv layer', () => {
  test('cameras load and render when operators are live', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'the layer rail flyout is desktop-only');
    const cat = await liveRegion(page, 'asia');
    test.skip(cat === null, 'asia camera providers offline right now: SOURCE OFFLINE (asserted)');
    expect(cat!.rows.length).toBeGreaterThan(0);
    await page.goto('/?c=22.3000,114.1700,9&layers=cctv');
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => page.evaluate(() => performance.getEntriesByType('resource').filter((e) => e.name.includes('/api/cctv?region=')).length), { timeout: 30_000 })
      .toBeGreaterThan(0);
  });

  test('clicking a camera opens its card and viewer with operator, licence and report/remove', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'desktop pointer test');
    const cat = await liveRegion(page, 'asia');
    test.skip(cat === null, 'asia camera providers offline right now: SOURCE OFFLINE (asserted)');
    const cam = isolated(cat!);
    test.skip(cam === null, 'no isolated camera to click');
    test.setTimeout(150_000);
    const loaded = page.waitForResponse((r) => r.url().includes('/api/cctv?region=asia') && r.status() === 200, { timeout: 90_000 });
    // Zoom 14 with Live Previews: the preview tiles are DOM buttons (no WebGL picking needed), so the
    // camera card opens the same way a user clicks a preview; a canvas click is tried first.
    await page.goto(`/?c=${cam!.lat.toFixed(5)},${cam!.lng.toFixed(5)},14&layers=cctv,cctv_previews`);
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });
    await loaded;
    const card = page.getByTestId('camera-card');
    const box = (await page.locator('canvas.maplibregl-canvas').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    if (!(await card.isVisible({ timeout: 2_000 }).catch(() => false))) {
      const tile = page.getByTestId('cctv-previews').getByRole('button').first();
      await expect(tile).toBeVisible({ timeout: 30_000 });
      await tile.click();
    }
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.getByTestId('camera-operator')).not.toBeEmpty({ timeout: 15_000 });
    await expect(card.getByTestId('camera-licence')).not.toBeEmpty();
    await expect(card.getByTestId('camera-report')).toHaveAttribute('href', /\/issues\/new\?/);
    await card.getByTestId('camera-open-viewer').click();
    const viewer = page.getByTestId('camera-viewer');
    await expect(viewer).toBeVisible({ timeout: 15_000 });
    await expect(viewer.getByTestId('camera-operator')).not.toBeEmpty({ timeout: 20_000 });
    await expect(viewer.getByTestId('camera-licence')).not.toBeEmpty();
    await expect(viewer.getByTestId('camera-report')).toBeVisible();
    await expect(viewer.getByTestId('viewer-observed')).not.toBeEmpty();
  });
});

test.describe('keyless instance', () => {
  test('never requests a key-only camera region and gets no 5xx from /api/cctv (R1-M5)', async ({ page }) => {
    const health = await (await page.request.get('/api/health')).json();
    test.skip(health.capabilities?.tfl?.enabled === true, 'TFL_APP_KEY configured on this server');
    const direct = await page.request.get('/api/cctv?region=uk');
    expect(direct.status()).toBe(200);
    const body = await direct.json();
    expect(body.disabledRegions).toEqual(['uk']);
    expect(body.providers.tfl.skipped).toBe('not-configured');
    const bad: string[] = [];
    const asked: string[] = [];
    page.on('response', (r) => {
      if (!r.url().includes('/api/cctv')) return;
      asked.push(r.url());
      // 503 is reserved for real upstream outages of configured providers (legitimate, asserted elsewhere).
      if (r.status() >= 500 && r.status() !== 503) bad.push(`${r.status()} ${r.url()}`);
    });
    await page.goto('/?c=51.5000,-0.1200,9&layers=cctv');
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => asked.some((u) => u.includes('/api/cctv?region=')), { timeout: 30_000 }).toBe(true);
    await page.waitForTimeout(3_000);
    expect(asked.filter((u) => u.includes('region=uk'))).toEqual([]);
    expect(bad).toEqual([]);
  });
});

test.describe('/cameras-notice', () => {
  test('loads with no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/cameras-notice');
    await expect(page.getByRole('heading', { level: 1, name: /cameras notice/i })).toBeVisible();
    await expect(page.getByText('No face, licence-plate or object recognition', { exact: false })).toBeVisible();
    await expect(page.getByRole('link', { name: /open a removal request/i })).toHaveAttribute('href', /issues\/new/);
    expect(errors).toEqual([]);
  });
});
