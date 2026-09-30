import { expect, test, type Page } from '@playwright/test';
import { SOURCES } from '../../src/lib/sources';
import { TOOLS } from '../../src/lib/tool-registry';

/**
 * design-system-hud, Phase 3 round 1 regressions: attribution visibility (R1-B1), the full source
 * register (docs B2), deep links beating the intro (R4-B2), exiting panels leaving the a11y tree
 * (R1-M2), compass / fullscreen (R1-M3) and 44 px phone view controls (R1-M4).
 */

async function boot(page: Page, path = '/') {
  await page.goto(path);
  await expect(page.getByRole('status', { name: /loading/i })).toBeHidden({ timeout: 45_000 });
}

test('R1-B1: the map attribution is visible — not under the status bar, bottom nav or FX overlay', async ({ page }) => {
  await boot(page);
  await expect(page.locator('.maplibregl-ctrl-attrib')).toBeAttached({ timeout: 60_000 });
  const s = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('.maplibregl-ctrl-bottom-right')!);
    return { z: Number(cs.zIndex), bottom: parseFloat(cs.bottom) };
  });
  expect(s.z).toBeGreaterThanOrEqual(5);
  expect(s.bottom).toBeGreaterThanOrEqual(28);
  const covered = await page.evaluate(() => {
    const a = document.querySelector('.maplibregl-ctrl-attrib')!;
    const r = a.getBoundingClientRect();
    return [0.1, 0.5, 0.9]
      .map((f) => document.elementFromPoint(r.x + r.width * f, r.y + r.height / 2))
      .filter((el) => !el || !a.contains(el))
      .map((el) => el?.outerHTML.slice(0, 80));
  });
  expect(covered).toEqual([]);
  const overlap = await page.evaluate(() => {
    const a = document.querySelector('.maplibregl-ctrl-attrib')!.getBoundingClientRect();
    return ['footer', 'nav[aria-label="Main"]']
      .map((sel) => document.querySelector(sel))
      .filter((el): el is Element => !!el && (el as HTMLElement).offsetParent !== null)
      .map((el) => el.getBoundingClientRect())
      .some((b) => a.bottom > b.top && a.top < b.bottom && a.right > b.left && a.left < b.right);
  });
  expect(overlap).toBe(false);
});

test('docs-B2: SOURCES & LICENCES renders every registry entry with its licence', async ({ page }) => {
  await boot(page, '/?panel=attribution');
  const panel = page.getByRole('region', { name: 'SOURCES & LICENCES' });
  await expect(panel).toBeVisible();
  await expect(panel.getByText(`${SOURCES.length} SOURCES IN THE REGISTER`)).toBeVisible();
  for (const s of SOURCES) {
    const row = panel.getByTestId(`source-${s.id}`);
    await expect(row, s.id).toBeAttached();
    await expect(row, s.id).toContainText(s.licence);
  }
  await expect(panel).not.toContainText('Computed in the browser');
  await expect(panel).not.toContainText('has answered (switch the layer on)');
});

test('R4-B2: ?route=LHR-JFK opens PATHS and the intro fly-in does not override the deep link', async ({ page }) => {
  await boot(page, '/?route=LHR-JFK');
  const label = TOOLS.find((t) => t.id === 'paths')!.label;
  const paths = page.getByRole('region', { name: label, exact: true });
  await expect(paths).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(/route=LHR-JFK/);
});

test.describe('desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop layout');

  test('R1-M2: a closed or pinned panel leaves the accessibility tree at once', async ({ page }) => {
    await boot(page);
    await page.getByRole('button', { name: 'SOURCES & LICENCES' }).click();
    const sources = page.getByRole('region', { name: 'SOURCES & LICENCES' });
    await expect(sources).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sources).toHaveCount(0, { timeout: 1_000 });

    await page.keyboard.press('l');
    const layers = page.getByRole('region', { name: 'LAYERS' });
    await expect(layers).toBeVisible();
    await layers.getByRole('button', { name: 'Pin LAYERS' }).click();
    await expect(page.getByRole('group', { name: 'Pinned panels' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'LAYERS' })).toHaveCount(1, { timeout: 1_000 });
    await page.getByRole('button', { name: 'Unpin LAYERS' }).click();
    await expect(page.getByRole('region', { name: 'LAYERS' })).toHaveCount(1, { timeout: 1_000 });
    await expect(page.getByRole('group', { name: 'Pinned panels' })).toHaveCount(0);
    // Exiting copies are inert: nothing inside them keeps focus.
    expect(await page.evaluate(() => !!document.activeElement?.closest('[data-exiting]'))).toBe(false);
  });

  test('R1-M3: compass shows while rotated/tilted and resets north; fullscreen button toggles', async ({ page }) => {
    await boot(page, '/?c=48.85,2.35,5,40,30');
    const compass = page.getByRole('button', { name: 'Reset north and tilt' });
    await expect(compass).toBeVisible({ timeout: 60_000 });
    await compass.click();
    await expect(compass).toHaveCount(0, { timeout: 15_000 });
    const fs = page.getByRole('button', { name: 'Fullscreen' });
    await expect(fs).toBeVisible();
    await expect(fs).toHaveAttribute('aria-pressed', 'false');
  });
});

test.describe('phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone layout');

  test('R1-M4: every view-strip control is at least 44 px', async ({ page }) => {
    await boot(page);
    const strip = page.getByRole('group', { name: 'Projection' }).locator('xpath=..');
    const buttons = strip.getByRole('button');
    const n = await buttons.count();
    expect(n).toBeGreaterThanOrEqual(5);
    for (let i = 0; i < n; i++) {
      const box = (await buttons.nth(i).boundingBox())!;
      expect(box.height, await buttons.nth(i).innerText()).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
  });

  test('R1-M3: palette, shortcuts, reset, fullscreen and sensor modes are reachable from Settings', async ({ page }) => {
    await boot(page);
    const nav = page.getByRole('navigation', { name: 'Main' });
    await nav.getByRole('button', { name: 'LAYERS' }).click();
    await page.getByRole('tablist', { name: 'Sheet sections' }).getByRole('tab', { name: 'SETTINGS' }).click();
    const settings = page.getByRole('region', { name: 'SETTINGS' });
    for (const name of ['COMMANDS', 'RESET VIEW', 'SHORTCUTS']) await expect(settings.getByRole('button', { name })).toBeVisible();
    await settings.getByRole('radio', { name: 'NVG' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-sensor', 'nvg');
    await settings.getByRole('radio', { name: 'OFF' }).click();
    await settings.getByRole('button', { name: 'COMMANDS' }).click();
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  });
});
