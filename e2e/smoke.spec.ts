import { expect, test } from '@playwright/test';

/** Boot smoke test: the globe mounts, the splash lifts, health answers, nothing leaks upstream. */
test('globe boots with HUD and honest health', async ({ page, request }) => {
  const upstream: string[] = [];
  const errors: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).host;
    // Browsers may only talk to tile hosts and official video embeds (§11).
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) && !/(openfreemap\.org|arcgisonline\.com|earthdata\.nasa\.gov|amazonaws\.com|youtube(-nocookie)?\.com|ytimg\.com)$/.test(host)) upstream.push(r.url());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('status', { name: /loading/i })).toBeHidden({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'GODSEYE' })).toBeVisible();
  await expect(page.locator('.maplibregl-ctrl-attrib')).toBeVisible();

  const health = await request.get('/api/health');
  expect(health.ok()).toBe(true);
  expect((await health.json()).capabilities).toBeTruthy();

  expect(upstream).toEqual([]);
  expect(errors).toEqual([]);
});

test('API bodies decode as JSON whatever encoding the client accepts', async ({ request }) => {
  // Next >= 16.4 drops Content-Encoding from route-handler Responses: a body the app compressed
  // itself reached the browser as brotli bytes labelled JSON and crashed the map (cables: feedJson;
  // cctv/providers: compressedJson). Both are local reference data, so this needs no upstream.
  for (const path of ['/api/cables', '/api/cctv/providers']) {
    for (const enc of ['br, gzip', 'gzip', 'br', 'identity']) {
      const res = await request.get(path, { headers: { 'accept-encoding': enc } });
      expect(res.status(), `${path} (${enc})`).toBe(200);
      const text = (await res.body()).toString('utf8');
      expect(() => JSON.parse(text), `${path} (${enc})`).not.toThrow();
    }
  }
});

test('2D toggle switches projection and is shareable', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: '2D' }).click();
  await expect(page).toHaveURL(/proj=mercator/, { timeout: 5_000 });
});
