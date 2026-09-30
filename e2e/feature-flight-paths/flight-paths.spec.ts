import { expect, test, type Page } from '@playwright/test';
import { gotoMap, readCamera, waitForMapIdle } from '../map-engine/helpers';

/**
 * Flight Path Planner (§8). The plan uses bundled data (OurAirports, VRS standing data), so the
 * route, arc and labels are deterministic; METAR/winds/live aircraft come from upstreams and are
 * only asserted when present. Screenshots are taken in both projections (clocks masked).
 */
const status = (page: Page) => page.getByTestId('flight-paths-status');
const panel = (page: Page) => page.locator('section').filter({ has: page.getByRole('heading', { name: 'PATHS' }) });

test('GET /api/route/plan?from=EGLL&to=KJFK matches the §8 shape', async ({ request }) => {
  const res = await request.get('/api/route/plan?from=EGLL&to=KJFK', { timeout: 60_000 });
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(Math.abs(body.greatCircle.distanceKm - 5540)).toBeLessThanOrEqual(30);
  expect(Math.abs(body.greatCircle.initialBearing - 288)).toBeLessThanOrEqual(2);
  expect(body.greatCircle.points.length).toBeGreaterThanOrEqual(128);
  expect(body.knownServices.length).toBeGreaterThanOrEqual(3);
  expect(body.pathLabels).toContain('GREAT-CIRCLE ESTIMATE');
  expect(body.daylight).toHaveLength(10);
  expect(body.providers).toHaveProperty('ourairports');
  const nf = await request.get('/api/airports/ZZZZ');
  expect(nf.status()).toBe(404);
  expect((await nf.json()).error).toBe('not_found');
});

for (const proj of ['mercator', 'globe'] as const) {
  test(`?route=LHR-JFK restores the plan and draws the great circle (${proj})`, async ({ page }, info) => {
    test.setTimeout(180_000);
    await gotoMap(page, { params: { route: 'LHR-JFK', proj } });
    await expect(status(page)).toHaveAttribute('data-route', 'LHR-JFK');
    await expect(status(page)).toHaveAttribute('data-layers', /route-planned-arc/, { timeout: 60_000 });
    await expect(status(page)).toHaveAttribute('data-points', '256');
    const p = panel(page);
    await expect(p).toBeVisible({ timeout: 30_000 });
    await expect(p.getByText('LHR → JFK', { exact: true })).toBeVisible({ timeout: 60_000 });
    // Honest path labels: only the estimate exists without keyed sources.
    await expect(p.getByText('GREAT-CIRCLE ESTIMATE', { exact: true })).toBeVisible();
    await expect(p.getByText('TYPICAL · NOT AVAILABLE')).toBeVisible();
    await expect(p.getByText(/FILED( · NOT AVAILABLE)?$/)).toBeVisible();
    await expect(p.getByText('KNOWN SERVICES')).toBeVisible();
    await expect(p.getByText('BAW117').first()).toBeVisible();
    if (info.project.name === 'desktop') {
      // Fit-bounds (80 px + the docked panel) puts the whole LHR–JFK span on screen (R4-B2): the
      // camera centre lies inside the route's box (0.5°W … 73.8°W, 40.6°N … 55°N), not at the intro city.
      await waitForMapIdle(page);
      await expect
        .poll(async () => {
          const c = await readCamera(page);
          return c ? c.lat > 38 && c.lat < 60 && c.lng < 5 && c.lng > -80 : false;
        }, { timeout: 60_000 })
        .toBe(true);
      await page.waitForTimeout(1500); // tiles settle after the fly
      await page.screenshot({
        path: info.outputPath(`route-lhr-jfk-${proj}.png`),
        animations: 'disabled',
        mask: [page.locator('time'), page.locator('[data-testid="status-bar"]')],
      });
    }
  });
}

test('?flight=BA117 restores tracking in FLIGHT mode', async ({ page }) => {
  test.setTimeout(180_000);
  await gotoMap(page, { params: { flight: 'BA117', proj: 'mercator' } });
  await expect(status(page)).toHaveAttribute('data-flight', 'BA117');
  const p = panel(page);
  await expect(p).toBeVisible({ timeout: 30_000 });
  await expect(p.getByRole('tab', { name: 'FLIGHT' })).toHaveAttribute('aria-selected', 'true');
  await expect(p.getByText('BAW117').first()).toBeVisible({ timeout: 90_000 });
  const fa = p.getByRole('link', { name: /FlightAware/ });
  await expect(fa).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(status(page)).toHaveAttribute('data-layers', /route-planned-arc/, { timeout: 60_000 });
});

test('?route=ZZZZ-JFK opens PATHS with a friendly message (§8 acceptance)', async ({ page }) => {
  test.setTimeout(120_000);
  await gotoMap(page, { params: { route: 'ZZZZ-JFK' } });
  const p = panel(page);
  await expect(p).toBeVisible({ timeout: 30_000 });
  await expect(p.getByText(/Unknown airport: ZZZZ/)).toBeVisible({ timeout: 60_000 });
});

test('GET /api/flight/ZZZZ → 404 {error} (or 503 while a source is down, never an empty 200)', async ({ request }) => {
  const res = await request.get('/api/flight/ZZZZ', { timeout: 60_000 });
  expect([404, 503]).toContain(res.status());
  expect((await res.json()).error).toMatch(/not_found|source_offline/);
});

for (const proj of ['mercator', 'globe'] as const) {
  test(`?route=SYD-SCL draws one continuous line across the antimeridian (${proj})`, async ({ page }) => {
    test.setTimeout(180_000);
    await gotoMap(page, { params: { route: 'SYD-SCL', proj } });
    await expect(status(page)).toHaveAttribute('data-layers', /route-planned-arc/, { timeout: 60_000 });
    const step = Number(await status(page).getAttribute('data-max-lng-step'));
    expect(step).toBeLessThanOrEqual(180);
    await expect(panel(page)).toBeVisible({ timeout: 30_000 });
  });
}
