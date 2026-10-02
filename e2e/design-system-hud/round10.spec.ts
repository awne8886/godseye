import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * design-system-hud, Phase 3 round 10 MAJOR. Aviation and hazards dropped the feed's
 * meta.attribution from their layer status, so the rows fell back to raw provider keys, skipped
 * ones included ("Source: adsblol_tiles, …, opensky, adsbfi_mil"), and earthquake cards had no
 * licence line. /api/flights and /api/earthquakes are served from the recorded fixtures.
 */
test.describe.configure({ timeout: 180_000 });

const FIXTURES = join(process.cwd(), 'e2e/visual/fixtures');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');
const FLIGHTS = fixture('flights.json');
const EARTHQUAKES = fixture('earthquakes.json');
const ADSBLOL_CREDIT = 'Aircraft data © adsb.lol contributors, ODbL 1.0';
const USGS_CREDIT = 'Earthquakes: U.S. Geological Survey (USGS) Earthquake Hazards Program';

async function serveFixtures(page: Page) {
  await page.route(/\/api\/flights(\?|$)/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: FLIGHTS }));
  await page.route(/\/api\/earthquakes(\?|$)/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: EARTHQUAKES }));
}

async function boot(page: Page, query: string) {
  await page.goto(`/?${query}`);
  await expect(page.getByRole('status', { name: /loading/i })).toBeHidden({ timeout: 45_000 });
}

test('aviation rows credit adsb.lol (ODbL) and never name a skipped provider', async ({ page }) => {
  // The fixture's skipped providers: OpenSky (not configured) and adsb.fi (licence-gated).
  const providers = JSON.parse(FLIGHTS).providers as Record<string, { skipped?: string }>;
  expect(providers.opensky?.skipped).toBe('not-configured');
  expect(providers.adsbfi_mil?.skipped).toBe('licence');
  await serveFixtures(page);
  await boot(page, 'panel=layers&layers=flights,private,jets,military');
  const panel = page.getByRole('region', { name: 'LAYERS' });
  await expect(panel).toBeVisible();
  for (const id of ['flights', 'private', 'jets', 'military']) {
    const credit = panel.getByTestId(`attribution-${id}`);
    await expect(credit, id).toContainText(ADSBLOL_CREDIT, { timeout: 30_000 });
    await expect(credit, id).toContainText('ODbL-1.0');
    const rowEl = panel.locator('li').filter({ has: page.getByTestId(`attribution-${id}`) });
    await expect(rowEl.getByText(/^Source:/), id).toHaveCount(0);
    // adsb.fi is never named; OpenSky only as a key the instance lacks, never as a source.
    await expect(rowEl, id).not.toContainText(/adsb\.?fi/i);
    const text = (await rowEl.innerText()).replace(/NEEDS KEY ·[^\n]*/, '');
    expect(text, id).not.toMatch(/opensky/i);
  }
});

test('the earthquake card Sources tab shows the USGS credit', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'desktop pointer pick on the map');
  const quakes = JSON.parse(EARTHQUAKES).items as { lat: number; lng: number; magnitude: number }[];
  const q = [...quakes].sort((a, b) => b.magnitude - a.magnitude)[0]!;
  await serveFixtures(page);
  await page.goto(`/?c=${q.lat.toFixed(4)},${q.lng.toFixed(4)},6&layers=earthquakes`);
  const map = page.locator('canvas.maplibregl-canvas');
  const drawn = await map.waitFor({ state: 'visible', timeout: 100_000 }).then(
    () => true,
    () => false,
  );
  if (!drawn) test.skip(await page.getByText('BASEMAP UNAVAILABLE').isVisible(), 'the basemap style is unreachable from this network: no map canvas, nothing to pick');
  await expect(map).toBeVisible();
  await expect(page.getByRole('status', { name: /loading/i })).toBeHidden({ timeout: 45_000 });
  await page.waitForTimeout(1500);
  const vp = page.viewportSize()!;
  const card = page.getByTestId('hazard-card').filter({ visible: true }).first();
  await expect(async () => {
    await page.mouse.click(vp.width / 2, vp.height / 2);
    await expect(card).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  // Not `card` itself: its (overview) tabpanel is hidden once the Sources tab is open.
  const frame = page.locator('section').filter({ has: page.getByTestId('hazard-card') }).first();
  await frame.getByRole('tab', { name: 'sources' }).click();
  await expect(frame.getByText(USGS_CREDIT)).toBeVisible();
  await expect(frame.getByRole('link', { name: new RegExp(`${USGS_CREDIT.replace(/[()]/g, '\\$&')} · Public domain`) })).toHaveAttribute('href', 'https://earthquake.usgs.gov/earthquakes/feed/');
});

/**
 * Round 10 MINOR: with the pointer resting on one rail button, clicking the next group left the
 * previous flyout visible and the new one nearly transparent. One flyout is mounted at a time now.
 */
test('the rail shows one flyout: the group just clicked', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'the layer rail is desktop-only');
  await boot(page, 'layers=');
  const rail = page.getByRole('navigation', { name: 'Map layers' });
  const buttons = rail.locator('button[aria-controls^="flyout-"]');
  expect(await buttons.count()).toBeGreaterThan(1);
  const first = buttons.nth(0);
  const second = buttons.nth(1);
  await first.hover();
  await expect(page.locator('[data-flyout]')).toHaveCount(1);
  await expect(first).toHaveAttribute('aria-expanded', 'true');
  await second.click();
  await expect(second).toHaveAttribute('aria-expanded', 'true');
  const id = await second.getAttribute('aria-controls');
  const flyouts = page.locator('[data-flyout]');
  await expect(flyouts).toHaveCount(1);
  await expect(flyouts.first()).toHaveAttribute('id', id!);
  await expect.poll(() => flyouts.first().evaluate((el) => Number(getComputedStyle(el).opacity)), { timeout: 5_000 }).toBeGreaterThan(0.95);
  expect(await flyouts.first().evaluate((el) => getComputedStyle(el).filter)).toBe('none');
});
