import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * design-system-hud, Phase 3 round 6. M: desktop layer flyouts ran off the bottom of the screen and
 * sat under the view strip and status bar; every row of every group must now be reachable and
 * uncovered. m: the phone sensor chip covered the wordmark and said PRESS 0 on touch screens.
 * m: landscape sheets spent two rows on chrome. Each test sets its own viewport and runs once.
 */
test.describe.configure({ timeout: 180_000 });

async function boot(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole('status', { name: /loading/i })).toBeHidden({ timeout: 45_000 });
}

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** True when the topmost element at the centre of `target` lies inside `container`. */
async function onTop(target: Locator, container: Locator): Promise<boolean> {
  const box = (await target.boundingBox())!;
  const handle = await container.elementHandle();
  return target.page().evaluate(
    ([x, y, el]) => {
      const hit = document.elementFromPoint(x as number, y as number);
      return !!hit && (el as Element).contains(hit);
    },
    [box.x + box.width / 2, box.y + box.height / 2, handle] as const,
  );
}

for (const viewport of [
  { width: 1600, height: 1000 },
  { width: 1280, height: 720 },
]) {
  test.describe(`desktop ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test('r6 M: every layer row of every rail group is reachable above the view strip and status bar', async ({ page }, info) => {
      test.skip(info.project.name !== 'desktop', 'desktop project');
      await boot(page, '/?layers=');
      const rail = page.getByRole('navigation', { name: 'Map layers' });
      const status = (await page.locator('footer[data-map-inset="status-bar"]').boundingBox())!;
      const strip = (await page.getByTestId('view-controls').boundingBox())!;
      const groups = rail.locator('button[aria-controls^="flyout-"]');
      const n = await groups.count();
      expect(n).toBeGreaterThan(4);
      for (let i = 0; i < n; i++) {
        const btn = groups.nth(i);
        const name = (await btn.getAttribute('aria-label'))!;
        await btn.click();
        const flyout = page.locator(`#${await btn.getAttribute('aria-controls')}`);
        await expect(flyout).toBeVisible();
        await page.waitForTimeout(300); // entry animation
        const box = (await flyout.boundingBox())!;
        expect(box.y, `${name} top`).toBeGreaterThanOrEqual(90);
        expect(box.y + box.height, `${name} bottom`).toBeLessThanOrEqual(status.y);
        if (overlaps(box, strip)) {
          const probe = { x: Math.max(box.x, strip.x) + 4, y: Math.max(box.y, strip.y) + 4 };
          const inside = await flyout.evaluate((el, p) => el.contains(document.elementFromPoint(p.x, p.y)), probe);
          expect(inside, `${name} above the view strip`).toBe(true);
        }
        const toggles = flyout.locator('li > button[aria-pressed]');
        const count = await toggles.count();
        expect(count, name).toBeGreaterThan(0);
        for (let j = 0; j < count; j++) {
          const t = toggles.nth(j);
          await t.scrollIntoViewIfNeeded();
          const tb = (await t.boundingBox())!;
          expect(tb.y + tb.height, `${name} row ${j}`).toBeLessThanOrEqual(status.y);
          expect(await onTop(t, flyout), `${name} row ${j} uncovered`).toBe(true);
        }
        if (i === n - 1 || name === 'SURVEILLANCE' || name === 'THREATS & INTEL') {
          await info.attach(`${viewport.width}-${name}.png`, { body: await page.screenshot(), contentType: 'image/png' });
        }
        await btn.click(); // unpin, then leave so hover does not hold it open
        await page.mouse.move(viewport.width / 2, viewport.height / 2);
        await expect(flyout).toBeHidden();
      }
    });
  });
}

const PHONES = [
  { name: 'portrait', viewport: { width: 390, height: 844 } },
  { name: 'landscape', viewport: { width: 844, height: 390 } },
] as const;

for (const { name, viewport } of PHONES) {
  test.describe(`phone ${name}`, () => {
    test.use({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

    test(`r6 m: ${name} sensor chip clears the wordmark and view bar, and clears on tap`, async ({ page }, info) => {
      test.skip(info.project.name !== 'desktop', 'sets its own viewport; once');
      await boot(page, '/?layers=');
      await page.keyboard.press('2');
      const chip = page.getByTestId('sensor-chip');
      await expect(chip).toBeVisible();
      const c = (await chip.boundingBox())!;
      for (const sel of ['header[data-map-inset="header"]', '[data-testid="view-controls"]']) {
        const b = (await page.locator(sel).boundingBox())!;
        expect(overlaps(c, b), `chip vs ${sel}`).toBe(false);
      }
      const clear = chip.getByRole('button', { name: 'TAP TO CLEAR' });
      expect((await clear.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await expect(chip.getByText('PRESS 0 TO CLEAR')).toBeHidden();
      await info.attach(`${name}-sensor.png`, { body: await page.screenshot(), contentType: 'image/png' });
      await clear.tap();
      await expect(chip).toBeHidden();
      await expect(page.locator('.sensor-nvg')).toHaveCount(0);
    });

    test(`r6 m: ${name} sheets keep tabs, chip and close on one row`, async ({ page }, info) => {
      test.skip(info.project.name !== 'desktop', 'sets its own viewport; once');
      for (const panel of ['settings', 'paths', 'search']) {
        await boot(page, `/?layers=&panel=${panel}`);
        const sheet = page.getByTestId('mobile-sheet');
        await expect(sheet).toBeVisible();
        await page.waitForTimeout(500); // spring settle
        const header = sheet.locator('[data-frame-header]');
        const close = header.getByRole('button', { name: /^Close / });
        await expect(close).toBeVisible();
        const tablist = sheet.getByRole('tablist', { name: 'Sheet sections' });
        if (await tablist.count()) {
          const tb = (await tablist.boundingBox())!;
          const cb = (await close.boundingBox())!;
          expect(Math.abs(tb.y + tb.height / 2 - (cb.y + cb.height / 2)), `${panel}: one row`).toBeLessThan(6);
        }
        const s = (await sheet.boundingBox())!;
        const body = (await sheet.locator('.hud-scroll').first().boundingBox())!;
        // Chrome (handle + one row + rule) leaves at least two thirds of the sheet for content.
        expect(body.height / s.height, `${panel}: content share`).toBeGreaterThan(0.6);
        // The sheet surface is the opaque glass elevation.
        const alpha = await sheet.locator('.glass-3').first().evaluate((el) => {
          const m = getComputedStyle(el).backgroundColor.match(/rgba?\(([^)]+)\)/);
          const parts = m ? m[1]!.split(/[ ,/]+/).filter(Boolean) : [];
          return parts.length === 4 ? Number(parts[3]) : 1;
        });
        expect(alpha).toBeGreaterThanOrEqual(0.96);
        // ...and it blurs what is behind it (the production CSS once dropped the unprefixed property).
        expect(await sheet.locator('.glass-3').first().evaluate((el) => getComputedStyle(el).backdropFilter)).toMatch(/blur\(/);
        await info.attach(`${name}-${panel}.png`, { body: await page.screenshot(), contentType: 'image/png' });
      }
    });
  });
}
