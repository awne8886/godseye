import { expect, test, type Page } from '@playwright/test';

/**
 * design-system-hud, Phase 3 round 7 minors. The desktop sensor chip no longer shares the header
 * row (the header scrim greyed it, the status strip ran under it); one terrain status line; the
 * phone sheet keeps the selected tab readable; layer rows fold long credits into SOURCES (N).
 * Each test sets its own viewport and runs once (desktop project).
 */
test.describe.configure({ timeout: 180_000 });

async function boot(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole('status', { name: /loading/i })).toBeHidden({ timeout: 45_000 });
}

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

for (const viewport of [
  { width: 1600, height: 1000 },
  { width: 1280, height: 720 },
]) {
  test.describe(`desktop ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test('r7 m: the sensor chip clears the header and the status strip and is drawn on top', async ({ page }, info) => {
      test.skip(info.project.name !== 'desktop', 'sets its own viewport; once');
      // Several live layers make the right-aligned status strip as wide as it gets.
      await boot(page, '/?layers=flights,earthquakes,fires,satellites,maritime');
      await page.keyboard.press('1');
      const chip = page.getByTestId('sensor-chip');
      await expect(chip).toBeVisible();
      await page.waitForTimeout(1500); // let the status strip pick up counts
      const c = (await chip.boundingBox())!;
      for (const sel of ['header[data-map-inset="header"]', '[data-map-inset="telemetry"]']) {
        const b = (await page.locator(sel).boundingBox())!;
        expect(overlaps(c, b), `chip vs ${sel}`).toBe(false);
      }
      // Nothing (the header scrim included) paints over the label or the clear control.
      for (const target of [chip.getByText(/^SENSOR · CRT$/), chip.getByText('PRESS 0 TO CLEAR')]) {
        const b = (await target.boundingBox())!;
        for (const fx of [0.1, 0.5, 0.9]) {
          const inside = await chip.evaluate((el, p) => el.contains(document.elementFromPoint(p.x, p.y)), { x: b.x + b.width * fx, y: b.y + b.height / 2 });
          expect(inside, `chip on top at ${fx}`).toBe(true);
        }
      }
      await info.attach(`${viewport.width}-sensor.png`, { body: await page.screenshot({ clip: { x: 0, y: 0, width: viewport.width, height: 160 } }), contentType: 'image/png' });
      await page.keyboard.press('0');
      await expect(chip).toBeHidden();
    });
  });
}

test.describe('desktop 1600x1000 terrain + flyout', () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  test('r7 m: 3D terrain status is printed once (the map chip stack)', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'sets its own viewport; once');
    await boot(page, '/?layers=terrain_elevation');
    await expect(page.getByTestId('imagery-chip-terrain')).toBeVisible({ timeout: 30_000 });
    const text = ((await page.getByTestId('imagery-chip-terrain').textContent()) ?? '').trim();
    await expect(page.getByText(text, { exact: true })).toHaveCount(1);
    await expect(page.locator('[data-map-inset="terrain-line"]')).toHaveCount(0);
  });

  test('r7 m: SURVEILLANCE rows sit within one screen; long credits fold into SOURCES (N)', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'sets its own viewport; once');
    await boot(page, '/?layers=cctv,live_news');
    const btn = page.getByRole('navigation', { name: 'Map layers' }).getByRole('button', { name: 'SURVEILLANCE' });
    await btn.click();
    const flyout = page.locator(`#${await btn.getAttribute('aria-controls')}`);
    await expect(flyout).toBeVisible();
    const cctv = flyout.getByRole('button', { name: /CCTV Cameras/ });
    // Wait for the feed to report (count badge) or fail (SOURCE OFFLINE): either way the row settles.
    await expect(flyout.getByTestId('attribution-cctv').or(flyout.getByText(/SOURCE OFFLINE/)).first()).toBeAttached({ timeout: 60_000 });
    const sources = flyout.getByTestId('sources-cctv');
    if (await sources.count()) {
      await expect(sources).not.toHaveAttribute('open', /.*/);
      await expect(sources.locator('summary')).toHaveText(/^SOURCES \(\d+\)/);
      // Every credit is still there, one click away.
      await sources.locator('summary').click();
      await expect(sources).toHaveAttribute('open', '');
      expect(await flyout.getByTestId('attribution-cctv').locator('li').count()).toBeGreaterThan(1);
      await sources.locator('summary').click();
    }
    // The last row's toggle is within one viewport of the first (it was > 2 screens below).
    const first = (await cctv.boundingBox())!;
    const last = flyout.getByRole('button', { name: /Live News Feeds/ });
    await last.scrollIntoViewIfNeeded();
    const firstAfter = (await cctv.boundingBox())!;
    const lb = (await last.boundingBox())!;
    expect(lb.y - firstAfter.y, 'distance first → last row').toBeLessThan(600);
    expect(first.height).toBeGreaterThan(0);
    await info.attach('surveillance.png', { body: await page.screenshot(), contentType: 'image/png' });
  });
});

test.describe('phone 390x844', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  for (const panel of ['style-studio', 'layers', 'attribution', 'settings']) {
    test(`r7 m: the selected sheet tab is fully readable (${panel})`, async ({ page }, info) => {
      test.skip(info.project.name !== 'desktop', 'sets its own viewport; once');
      await boot(page, `/?layers=&panel=${panel}`);
      const sheet = page.getByTestId('mobile-sheet');
      await expect(sheet).toBeVisible();
      const tablist = sheet.getByRole('tablist', { name: 'Sheet sections' });
      test.skip((await tablist.count()) === 0, 'single-section sheet');
      await page.waitForTimeout(800); // spring settle + late header tools/chip
      const selected = tablist.getByRole('tab', { selected: true });
      const tl = (await tablist.boundingBox())!;
      const tb = (await selected.boundingBox())!;
      expect(tb.x, 'tab start inside the strip').toBeGreaterThanOrEqual(tl.x - 0.5);
      // .hud-fade-right fades the last 24 px: the tab ends before it.
      expect(tb.x + tb.width, 'tab end clear of the fade').toBeLessThanOrEqual(tl.x + tl.width - 24 + 1);
      if (panel === 'style-studio') {
        expect(tl.width, 'strip keeps ≥ 240 px').toBeGreaterThanOrEqual(240);
        const copy = sheet.getByTestId('style-studio-sheet').getByRole('button', { name: 'Copy theme JSON' });
        await expect(copy).toBeVisible();
        expect((await copy.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      await info.attach(`phone-${panel}.png`, { body: await page.screenshot(), contentType: 'image/png' });
    });
  }
});
