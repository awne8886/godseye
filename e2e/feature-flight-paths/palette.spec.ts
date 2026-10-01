import { expect, test, type Page } from '@playwright/test';
import { gotoMap } from '../map-engine/helpers';

/**
 * Round 4 M2 (palette guesses): "Atlantis to London" in the command palette must not silently plan
 * ACY→LHR. /api/airports/search answers "Atlantis" only with a fuzzy guess (ACY, Atlantic City),
 * so PATHS opens with FROM/TO pre-filled, says "Did you mean ACY (Atlantic City)?" and offers a
 * one-click accept; accepting fills FROM and plans the route (TO resolved to the London metro's
 * first airport). The airport index is bundled (OurAirports), so the guess is deterministic.
 */
const status = (page: Page) => page.getByTestId('flight-paths-status');
const panel = (page: Page) => page.locator('section').filter({ has: page.getByRole('heading', { name: 'FLIGHT PATHS' }) });

test('palette "Atlantis to London" → PATHS offers "Did you mean ACY (Atlantic City)?"; accepting fills FROM', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the command palette is a keyboard flow (desktop)');
  test.setTimeout(120_000);
  await gotoMap(page);
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await page.keyboard.type('Atlantis to London');
  await expect(palette.getByRole('option', { name: /Plan route ATLANTIS → LONDON/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(palette).toBeHidden();

  const p = panel(page);
  await expect(p).toBeVisible({ timeout: 30_000 });
  // The suggestion, never a silently planned guess.
  await expect(p.getByRole('status').filter({ hasText: 'Did you mean ACY (Atlantic City)?' })).toHaveText('No airport named "Atlantis". Did you mean ACY (Atlantic City)?', { timeout: 30_000 });
  await expect(status(page)).toHaveAttribute('data-route', '');
  const from = p.getByLabel('FROM', { exact: true });
  const to = p.getByLabel('TO', { exact: true });
  await expect(from).toHaveValue('Atlantis');
  await expect(to).toHaveValue('LHR');

  // One-click accept fills FROM and, with TO resolved, plans the route.
  const accept = p.getByRole('button', { name: 'Use ACY (Atlantic City) as origin' });
  await expect(accept).toHaveText('USE ACY (Atlantic City) AS FROM');
  await accept.click();
  await expect(from).toHaveValue('ACY');
  await expect(p.getByText('Did you mean ACY (Atlantic City)?')).toHaveCount(0);
  await expect(status(page)).toHaveAttribute('data-route', 'ACY-LHR', { timeout: 30_000 });
  await expect(p.getByText('ACY → LHR', { exact: true })).toBeVisible({ timeout: 60_000 });
});

/**
 * Round 5 B2: "City to City" plans the main airport of each city — "Bali to Sydney" planned BLC
 * (Bali, Cameroon) → BWU (Bankstown) in round 5 — and, when a city has no main airport (Kyiv: no
 * scheduled service), PATHS says "No main airport found" with a suggestion instead of planning.
 */
test('palette "Bali to Sydney" plans DPS → SYD (the main airports), never the namesake fields', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the command palette is a keyboard flow (desktop)');
  test.setTimeout(120_000);
  await gotoMap(page);
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await page.keyboard.type('Bali to Sydney');
  await expect(palette.getByRole('option', { name: /Plan route BALI → SYDNEY/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(palette).toBeHidden();
  await expect(status(page)).toHaveAttribute('data-route', 'DPS-SYD', { timeout: 30_000 });
  await expect(panel(page).getByText('DPS → SYD', { exact: true })).toBeVisible({ timeout: 60_000 });
});

test('palette "Kiev to Warsaw" → "No main airport found for "Kiev". Did you mean IEV (Kyiv)?", nothing planned', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the command palette is a keyboard flow (desktop)');
  test.setTimeout(120_000);
  await gotoMap(page);
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await page.keyboard.type('Kiev to Warsaw');
  await expect(palette.getByRole('option', { name: /Plan route KIEV → WARSAW/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(palette).toBeHidden();
  const p = panel(page);
  await expect(p.getByRole('status').filter({ hasText: 'Did you mean IEV (Kyiv)?' })).toHaveText('No main airport found for "Kiev". Did you mean IEV (Kyiv)?', { timeout: 30_000 });
  await expect(status(page)).toHaveAttribute('data-route', '');
  await expect(p.getByLabel('FROM', { exact: true })).toHaveValue('Kiev');
  await expect(p.getByLabel('TO', { exact: true })).toHaveValue('WAW');
});
