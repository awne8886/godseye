import { expect, test, type Page } from '@playwright/test';

/**
 * layers-space end-to-end checks. Upstream-dependent steps skip (with the reason) when the server
 * reports SOURCE OFFLINE for the catalogue, so a firewalled sandbox never fakes a pass or a failure.
 */

async function bootGlobe(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });
}

test('satellites: the catalogue loads, propagates and is counted per category when live', async ({ page, request, isMobile }) => {
  test.skip(isMobile, 'the layer rail is desktop-only; mobile uses the layers sheet');
  const api = await request.get('/api/satellites');
  test.skip(api.status() === 503, 'CelesTrak and SatNOGS are both offline from this network');
  expect(api.ok()).toBe(true);
  const body = await api.json();
  expect(body.rows.length).toBeGreaterThan(0);
  expect(body.providers).toBeTruthy();

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await bootGlobe(page, '/?layers=satellites');
  await page.getByRole('button', { name: 'SPACE TRACKING' }).click();
  // Rail flyouts are disclosures (button aria-expanded + aria-controls → region "<GROUP> layers").
  const flyout = page.getByRole('region', { name: 'SPACE TRACKING layers' });
  const allRow = flyout.getByRole('button', { name: /All Satellites/ });
  await expect(allRow).toHaveAttribute('aria-pressed', 'true');
  await expect(allRow).toContainText(/\d/, { timeout: 30_000 });
  const count = Number((await allRow.innerText()).replace(/[^\d]/g, ''));
  expect(count).toBeGreaterThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('SPACE panel opens with the official NASA stream and the ISS readout', async ({ page }) => {
  await bootGlobe(page, '/');
  const tool = page.getByRole('button', { name: /^SPACE$/ });
  test.skip((await tool.count()) === 0, 'the HUD tool strip (design-system-hud) is not mounted in this build');
  await tool.click();
  const panel = page.getByTestId('space-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('iframe')).toHaveAttribute('src', /^https:\/\/www\.youtube-nocookie\.com\/embed\/awQzjn72bI0\?/);
  await expect(panel.getByRole('link', { name: /YouTube/ })).toHaveAttribute('rel', /noopener/);
  await expect(panel.getByText(/ISS · NORAD 25544/)).toBeVisible();
});

test('satellite card shows the PROPAGATED badge and the element epoch', async ({ page, request }) => {
  const api = await request.get('/api/satellites');
  test.skip(api.status() === 503, 'CelesTrak and SatNOGS are both offline from this network');
  await bootGlobe(page, '/?layers=satellites');
  const tool = page.getByRole('button', { name: /^SPACE$/ });
  test.skip((await tool.count()) === 0, 'the HUD tool strip / card host (design-system-hud) is not mounted in this build');
  await tool.click();
  const track = page.getByRole('button', { name: /Track ISS on globe/ });
  await expect(track).toBeEnabled({ timeout: 30_000 });
  await track.click();
  const card = page.getByTestId('satellite-card').first();
  await expect(card).toBeVisible();
  await expect(card.getByText('Propagated', { exact: true })).toBeVisible();
  await expect(card).toContainText(/Propagated from elements of \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/);
  await expect(card).toContainText('25544');
  // The 1 Hz worker frame fills in the altitude (never observed, always propagated).
  await expect(card.getByText(/\d{3} km$/)).toBeVisible({ timeout: 10_000 });
});
