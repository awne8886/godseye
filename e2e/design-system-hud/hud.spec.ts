import { expect, test, type Page } from '@playwright/test';
import { KEY_BINDINGS } from '../../src/lib/keyboard';
import { TOOLS } from '../../src/lib/tool-registry';

/**
 * design-system-hud: panels open/close, keyboard map = help overlay, Style Studio presets, modal
 * focus traps, focus-visible ring, accessible names, sensor modes, mobile nav + sheets.
 */

async function boot(page: Page, path = '/') {
  await page.goto(path);
  await expect(page.getByRole('status', { name: /loading/i })).toBeHidden({ timeout: 30_000 });
}

test.describe('desktop HUD', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop layout');

  test('keyboard map matches the help overlay exactly', async ({ page }) => {
    await boot(page);
    await page.keyboard.press('?');
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    const rows = dialog.locator('tbody tr');
    await expect(rows).toHaveCount(KEY_BINDINGS.length);
    for (let i = 0; i < KEY_BINDINGS.length; i++) {
      const b = KEY_BINDINGS[i]!;
      await expect(rows.nth(i).locator('kbd')).toHaveText(b.display);
      await expect(rows.nth(i).locator('td').nth(1)).toHaveText(b.description);
    }
    // Focus is trapped inside the modal.
    for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('HUD panels open and close from their launchers and keys', async ({ page }) => {
    // Nine launcher round-trips; under a loaded CI box each click can wait seconds for actionability.
    test.slow();
    await boot(page);
    // L → layers
    await page.keyboard.press('l');
    const layers = page.getByRole('region', { name: 'LAYERS' });
    await expect(layers).toBeVisible();
    await expect(layers.getByRole('button', { name: 'Earthquakes' })).toBeVisible();
    await page.keyboard.press('l');
    await expect(layers).toBeHidden();
    // S → share, with a restorable link
    await page.keyboard.press('s');
    const share = page.getByRole('region', { name: 'SHARE' });
    await expect(share).toBeVisible();
    await expect(share.getByRole('textbox', { name: 'Share link' })).toHaveValue(/^http:\/\/127\.0\.0\.1:\d+\/\?/);
    await share.getByRole('button', { name: 'Close SHARE' }).click();
    await expect(share).toBeHidden();
    // Status-bar launchers
    await page.getByRole('button', { name: 'SOURCES & LICENCES' }).click();
    await expect(page.getByRole('region', { name: 'SOURCES & LICENCES' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('region', { name: 'SOURCES & LICENCES' })).toBeHidden();
    // Rail-bottom launchers
    await page.getByRole('button', { name: 'Settings' }).click();
    const settings = page.getByRole('region', { name: 'SETTINGS' });
    await expect(settings).toBeVisible();
    await settings.getByRole('radio', { name: 'METRIC' }).click();
    await expect(settings.getByRole('radio', { name: 'METRIC' })).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    // Palette → region presets panel
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await page.keyboard.type('region presets');
    await page.keyboard.press('Enter');
    await expect(palette).toBeHidden();
    await expect(page.getByRole('region', { name: 'REGION PRESETS' })).toBeVisible();
    // Pin it, then close it from the pinned column
    await page.getByRole('button', { name: 'Pin REGION PRESETS' }).click();
    await expect(page.getByRole('group', { name: 'Pinned panels' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'REGION PRESETS' })).toHaveCount(1);
    await page.getByRole('group', { name: 'Pinned panels' }).getByRole('button', { name: 'Close REGION PRESETS' }).click();
    await expect(page.getByRole('region', { name: 'REGION PRESETS' })).toBeHidden();
  });

  test('the docked panel column resizes from the keyboard and remembers its width', async ({ page }) => {
    await boot(page);
    await page.keyboard.press('l');
    const handle = page.getByRole('separator', { name: 'Resize panel' });
    await expect(handle).toHaveAttribute('aria-valuenow', '360');
    await handle.focus();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(handle).toHaveAttribute('aria-valuenow', '400');
    const box = await page.getByRole('region', { name: 'LAYERS' }).boundingBox();
    expect(Math.round(box!.width)).toBe(400);
    expect(await page.evaluate(() => localStorage.getItem('godseye:panel-width'))).toBe('400');
  });

  test('every registered tool in the strip toggles its panel', async ({ page }) => {
    // R1 m9: a HUD test, so it boots without data layers. The toggle itself renders its panel in
    // 30–150 ms (measured in the page), but with the default ~40k entities SwiftShader draws one
    // frame every 1–3 s and each click waits for Playwright's stable-frame checks (2–11 s per
    // click in round 4). The checks are unchanged: real pointer clicks, aria-pressed, the named
    // region, close again.
    await boot(page, '/?layers=');
    for (const t of TOOLS) {
      const btn = page.getByRole('navigation', { name: 'Tools' }).getByRole('button', { name: t.label, exact: true });
      if ((await btn.count()) === 0) continue; // panel not registered in this build
      await expect(btn).toHaveAttribute('title', t.tooltip);
      await btn.click();
      await expect(btn).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('region', { name: t.label, exact: true })).toBeVisible();
      await btn.click();
      await expect(btn).toHaveAttribute('aria-pressed', 'false');
    }
  });

  test('Style Studio switches presets, persists them and applies Ghost last', async ({ page }) => {
    // HUD-only: no data layers, so a click does not wait seconds for stable frames (R1 m9).
    await boot(page, '/?layers=');
    await page.getByRole('button', { name: 'Style Studio' }).click();
    const studio = page.getByRole('dialog', { name: 'Style Studio' });
    await expect(studio).toBeVisible();
    await studio.getByRole('radio', { name: 'EMBER' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'EMBER');
    const gold = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--gold-primary').trim());
    expect(await gold()).toBe('#ff8a3d');
    expect(await page.evaluate(() => localStorage.getItem('godseye:theme'))).toBe('EMBER');
    await studio.getByRole('button', { name: /GHOST PROTOCOL/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-ghost', '');
    expect(await gold()).toBe('#b388ff');
    await studio.getByRole('button', { name: /GHOST PROTOCOL/ }).click();
    // Contrast readout passes for the preset
    await expect(studio.getByRole('list', { name: 'Live contrast readout' })).not.toContainText('FAIL');
    await page.keyboard.press('Escape');
    await expect(studio).toBeHidden();
    // The pre-paint boot script restores the saved preset on a fresh URL (localStorage only)
    await page.goto('/?layers=');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'EMBER');
    await expect(page.getByRole('status', { name: /loading/i })).toBeHidden({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Style Studio' }).click();
    await page.getByRole('dialog', { name: 'Style Studio' }).getByRole('radio', { name: 'HORUS' }).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  });

  test('sensor modes follow keys 1–4 and 0', async ({ page }) => {
    await boot(page);
    await page.keyboard.press('2');
    await expect(page.locator('html')).toHaveAttribute('data-sensor', 'nvg');
    await page.keyboard.press('3');
    await expect(page.locator('html')).toHaveAttribute('data-sensor', 'flir');
    await page.keyboard.press('0');
    await expect(page.locator('html')).not.toHaveAttribute('data-sensor', /.+/);
  });

  test('controls have names, toggles expose state, focus ring is gold', async ({ page }) => {
    await boot(page);
    const unnamed = await page.evaluate(() =>
      [...document.querySelectorAll('button, a[href], input, [role="button"]')]
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .filter((el) => {
          const label = el.getAttribute('aria-label') || el.getAttribute('title') || (el as HTMLElement).innerText || (el as HTMLInputElement).labels?.[0]?.innerText;
          return !label || !label.trim();
        })
        .map((el) => el.outerHTML.slice(0, 120)),
    );
    expect(unnamed).toEqual([]);
    const rail = page.getByRole('navigation', { name: 'Map layers' });
    const first = rail.getByRole('button').first();
    await expect(first).toHaveAttribute('aria-expanded', 'false');
    await first.click();
    await expect(first).toHaveAttribute('aria-expanded', 'true');
    const flyout = page.getByRole('region', { name: /layers$/ }).first();
    await expect(flyout).toBeVisible();
    await expect(flyout.getByRole('button', { pressed: true }).or(flyout.getByRole('button', { pressed: false })).first()).toBeVisible();
    await page.keyboard.press('Escape');
    await page.mouse.move(800, 500);
    await expect(first).toHaveAttribute('aria-expanded', 'false');
    await first.focus();
    await page.keyboard.press('Tab');
    const outline = await page.evaluate(() => {
      const s = getComputedStyle(document.activeElement as Element);
      return `${s.outlineStyle} ${s.outlineColor}`;
    });
    expect(outline).toMatch(/solid rgb\(212, 175, 55\)/);
  });
});

test.describe('mobile HUD', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone layout');

  test('bottom nav reaches every sheet with 44 px targets', async ({ page }) => {
    // HUD-only, so no data layers (R1 m9): with the default layers a phone-sized SwiftShader page
    // draws a frame every few seconds and each tab click waits for two stable frames.
    await boot(page, '/?layers=');
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav).toBeVisible();
    const buttons = nav.getByRole('button');
    const n = await buttons.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      const box = await buttons.nth(i).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
    await nav.getByRole('button', { name: 'LAYERS' }).click();
    const tabs = page.getByRole('tablist', { name: 'Sheet sections' });
    await expect(tabs).toBeVisible();
    await expect(page.getByRole('region', { name: 'LAYERS' })).toBeVisible();
    await tabs.getByRole('tab', { name: 'REGION PRESETS' }).click();
    await expect(page.getByRole('region', { name: 'REGION PRESETS' })).toBeVisible();
    await tabs.getByRole('tab', { name: 'SETTINGS' }).click();
    await expect(page.getByRole('region', { name: 'SETTINGS' })).toBeVisible();
    await tabs.getByRole('tab', { name: 'STYLE STUDIO' }).click();
    // Phones show Style Studio inside the bottom sheet (R3-m2), never as a dialog over the map.
    const sheet = page.getByTestId('mobile-sheet');
    await expect(sheet.getByTestId('style-studio-sheet')).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Style Studio' })).toHaveCount(0);
    await sheet.getByRole('button', { name: 'Close STYLE STUDIO', exact: true }).click();
    await expect(page.getByTestId('style-studio-sheet')).toHaveCount(0);
    await nav.getByRole('button', { name: 'SEARCH' }).or(nav.getByRole('button', { name: 'LAYERS' })).first().click();
  });
});
