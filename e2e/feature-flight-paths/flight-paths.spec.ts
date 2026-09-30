import { expect, test, type Page } from '@playwright/test';
import { gotoMap } from '../map-engine/helpers';

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
      await page.waitForTimeout(2500); // fly-to settles
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
