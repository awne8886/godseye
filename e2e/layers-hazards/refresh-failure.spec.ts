import { expect, test } from '@playwright/test';
import { openMap } from './helpers';

/**
 * Verification round 8 (BLOCKING): a refresh that fails with anything but the app's own 503 kept the
 * layer LIVE forever (react-query retained the previous snapshot and the hook only reported offline
 * when there was none). Here the first /api/earthquakes answer is the real one and every later
 * poll gets a reverse-proxy 502: at the first failed poll (60 s interval + react-query's 1 s / 2 s
 * retries) the rail must leave LIVE for STALE, keep the retained count, and never go back to LIVE.
 * Desktop only: the layer rail flyout is not on the phone layout.
 */
test('Earthquakes leaves LIVE for STALE when every refresh after the first load is a 502', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'the layer rail flyout is desktop-only');
  // needsBasemap() may wait out the style's retries; then one 60 s poll plus its retries.
  test.setTimeout(300_000);
  const probe = await page.request.get('/api/earthquakes');
  test.skip(probe.status() === 503, 'USGS offline right now: /api/earthquakes answered SOURCE OFFLINE, nothing LIVE to downgrade');
  expect(probe.ok()).toBe(true);

  let passed = 0;
  let failed = 0;
  await page.route('**/api/earthquakes*', async (route) => {
    if (passed === 0) {
      passed += 1;
      return route.fallback();
    }
    failed += 1;
    return route.fulfill({ status: 502, contentType: 'text/html', body: '<html><body><h1>502 Bad Gateway</h1></body></html>' });
  });

  await openMap(page, 'c=20.0000,0.0000,2&layers=earthquakes');
  await page.getByRole('button', { name: 'NATURAL HAZARDS' }).click();
  const row = page.getByRole('button', { name: /Earthquakes/ });
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  await expect(row).toContainText(/\d/, { timeout: 30_000 });
  const count = (await row.innerText()).match(/([\d,]+)\s*$/)?.[1];
  const desc = page.locator(`[id="${await row.getAttribute('aria-describedby')}"]`);
  // The server's own state for the one good answer (LIVE, or its age when the cache had aged).
  await expect(desc).toContainText(/LIVE|\d+[smhd]\b/, { timeout: 15_000 });

  await expect(desc).toContainText('STALE', { timeout: 100_000 });
  expect(failed).toBeGreaterThan(0);
  await expect(desc).not.toContainText('LIVE');
  // The retained snapshot stays drawn and counted (badged STALE), not cleared.
  await expect(row).toContainText(count!);
  await expect(desc).not.toContainText('SOURCE OFFLINE');
  // Another failed poll later: still not LIVE.
  const before = failed;
  await expect.poll(() => failed, { timeout: 100_000 }).toBeGreaterThan(before);
  await expect(desc).toContainText('STALE');
  await expect(desc).not.toContainText('LIVE');
});
