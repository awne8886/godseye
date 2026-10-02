import { expect, test, type Page } from '@playwright/test';

/**
 * design-system-hud, Phase 3 round 3 minors: palette STYLE STUDIO opens on desktop (R3-m1), the
 * phone Style Studio is the bottom sheet and never covers the header/view controls (R3-m2), the
 * header keeps its entity count while drawing (R3-m6), INTEL FEED selects are HUD uppercase (n5),
 * and SPACE has one header and no empty player box (R3-m7, n6). R3-M1 lives in round2.spec.ts.
 */
test.describe.configure({ timeout: 120_000 });

async function boot(page: Page, path = '/') {
  await page.goto(path);
  await expect(page.getByRole('status', { name: /loading/i })).toBeHidden({ timeout: 45_000 });
  await expect(page.locator('.maplibregl-ctrl-attrib')).toBeAttached({ timeout: 60_000 });
}

test('R3-m1: "STYLE STUDIO" + Enter in the palette opens the studio', async ({ page, isMobile }) => {
  await boot(page);
  if (isMobile) {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'LAYERS' }).click();
    await page.getByRole('tablist', { name: 'Sheet sections' }).getByRole('tab', { name: 'STYLE STUDIO' }).click();
    await expect(page.getByRole('region', { name: 'STYLE STUDIO' })).toBeVisible();
    return;
  }
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  await page.keyboard.type('STYLE STUDIO');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'STYLE STUDIO' })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Theme preset' })).toBeVisible();
});

test.describe('phone Style Studio', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone layout');

  test('R3-m2: opens in the bottom sheet, clear of the header and view controls', async ({ page }) => {
    await boot(page, '/?panel=style-studio');
    const sheet = page.getByTestId('mobile-sheet');
    await expect(sheet.getByTestId('style-studio-sheet')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const sheetTop = (await sheet.boundingBox())!.y;
    for (const name of ['Projection', 'Basemap']) {
      const box = await page.getByRole('group', { name, exact: true }).boundingBox();
      if (box) expect(box.y + box.height).toBeLessThanOrEqual(sheetTop + 0.5);
    }
    // 44 px targets in the sheet.
    const copy = (await sheet.getByRole('button', { name: 'Copy theme JSON' }).boundingBox())!;
    expect(copy.height).toBeGreaterThanOrEqual(44);
  });
});

test('R3-m6: the header shows a count (received while drawing) rather than hiding it', async ({ page, isMobile }) => {
  test.skip(isMobile, 'telemetry entities are desktop-only');
  await boot(page, '/?layers=earthquakes');
  const entities = page.getByTestId('telemetry-entities');
  await expect(entities).toHaveText(/^(\d[\d,]* ENTITIES|\d[\d,]* RECEIVED \+ DRAWING|ENTITIES LOADING)$/);
  // Once the earthquakes feed has answered, a non-zero count is never replaced by "LOADING".
  await expect(entities).toHaveText(/^\d[\d,]* (ENTITIES|RECEIVED \+ DRAWING)$/, { timeout: 60_000 });
});

test('n5: INTEL FEED selects use HUD uppercase', async ({ page }) => {
  await boot(page, '/?panel=intel');
  const panel = page.getByTestId('intel-panel');
  await expect(panel).toBeVisible();
  const selects = panel.locator('select');
  await expect(selects).toHaveCount(2);
  for (const sel of await selects.all()) {
    await expect(sel).toHaveCSS('text-transform', 'uppercase');
    const texts = await sel.locator('option').allTextContents();
    for (const t of texts) expect(t).toBe(t.toUpperCase());
  }
  await expect(selects.first().locator('option').first()).toHaveText('ALL LAYERS');
});

test('R3-m7 / n6: SPACE has one header and never an empty player box', async ({ page }) => {
  await boot(page, '/?panel=space');
  const panel = page.getByRole('region', { name: 'SPACE', exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { level: 2 })).toHaveCount(1);
  await expect(panel.getByRole('button', { name: /^Close/ })).toHaveCount(1);
  const player = panel.getByTestId('space-player');
  const state = await player.getAttribute('data-state');
  if (state === 'ready') {
    expect((await player.boundingBox())!.height).toBeGreaterThan(100);
  } else {
    expect((await player.boundingBox())?.height ?? 0).toBe(0);
    await expect(panel.getByTestId('space-player-status')).toBeVisible();
  }
});
