import { expect, test, type Page } from '@playwright/test';

/**
 * design-system-hud, Phase 3 round 2: attribution legibility (R2-M1, n10) on both projects with
 * the contrast computed from computed styles, credits staying visible above an open phone sheet
 * (m2), the closing phone sheet leaving the a11y tree (m5), and the cursor readout never
 * overprinting the hint line (R2-M5) at 1280 and 1920 px.
 */

async function boot(page: Page, path = '/') {
  await page.goto(path);
  await expect(page.getByRole('status', { name: /loading/i })).toBeHidden({ timeout: 45_000 });
  await expect(page.locator('.maplibregl-ctrl-attrib')).toBeAttached({ timeout: 60_000 });
}

/**
 * Worst-case WCAG contrast of every text run in the attribution: the control's own background is
 * composited over pure white and pure black (whatever imagery is underneath) and the lower ratio
 * counts. Runs in the page so it reads the real computed colours.
 */
function attributionContrast(page: Page) {
  return page.evaluate(() => {
    const parse = (c: string) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1]!.split(/[\s,/]+/).filter(Boolean).map(Number);
      return { r: p[0]!, g: p[1]!, b: p[2]!, a: p.length > 3 ? p[3]! : 1 };
    };
    const lin = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const lum = (c: { r: number; g: number; b: number }) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
    const over = (f: { r: number; g: number; b: number; a: number }, b: { r: number; g: number; b: number }) => ({
      r: f.r * f.a + b.r * (1 - f.a),
      g: f.g * f.a + b.g * (1 - f.a),
      b: f.b * f.a + b.b * (1 - f.a),
    });
    const ratio = (x: number, y: number) => (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    const ctrl = document.querySelector('.maplibregl-ctrl-attrib') as HTMLElement;
    const bg = parse(getComputedStyle(ctrl).backgroundColor)!;
    const runs = [ctrl, ...ctrl.querySelectorAll<HTMLElement>('a, span')].filter((el) => (el.textContent ?? '').trim());
    let worst = Infinity;
    for (const el of runs) {
      const fg = parse(getComputedStyle(el).color)!;
      for (const base of [
        { r: 255, g: 255, b: 255 },
        { r: 0, g: 0, b: 0 },
      ]) {
        const back = over(bg, base);
        worst = Math.min(worst, ratio(lum(over(fg, back)), lum(back)));
      }
    }
    return { worst, bgAlpha: bg.a, text: ctrl.textContent ?? '' };
  });
}

/** Whether the attribution box is inside the viewport and on top at three points along it. */
function attributionVisible(page: Page) {
  return page.evaluate(() => {
    const a = document.querySelector('.maplibregl-ctrl-attrib')!;
    const r = a.getBoundingClientRect();
    const inside = r.left >= 0 && r.right <= window.innerWidth + 0.5 && r.top >= 0 && r.bottom <= window.innerHeight;
    const covered = [0.15, 0.5, 0.85]
      .map((f) => document.elementFromPoint(r.x + r.width * f, r.y + Math.min(r.height / 2, 7)))
      .filter((el) => !el || !a.contains(el)).length;
    const inner = a.querySelector('.maplibregl-ctrl-attrib-inner') as HTMLElement | null;
    const clipped = inner ? inner.scrollWidth > inner.clientWidth + 1 : false;
    return { inside, covered, clipped, rect: { x: r.x, y: r.y, w: r.width, h: r.height } };
  });
}

test('R2-M1 / n10: the attribution is on dark glass with >= 4.5:1 text, fully inside the viewport', async ({ page }) => {
  await boot(page);
  const c = await attributionContrast(page);
  expect(c.text).toMatch(/OpenStreetMap/);
  expect(c.bgAlpha).toBeGreaterThanOrEqual(0.9);
  expect(c.worst).toBeGreaterThanOrEqual(4.5);
  const v = await attributionVisible(page);
  expect(v, JSON.stringify(v.rect)).toMatchObject({ inside: true, covered: 0, clipped: false });
});

test.describe('phone sheet', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone layout');

  test('m2 / m5: credits stay visible above an open sheet; a closing sheet leaves the a11y tree at once', async ({ page }) => {
    await boot(page);
    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'LAYERS' }).click();
    const sheet = page.getByTestId('mobile-sheet');
    await expect(sheet).toBeVisible();
    await expect
      .poll(async () => {
        const v = await attributionVisible(page);
        const s = await sheet.boundingBox();
        return v.inside && v.covered === 0 && !!s && v.rect.y + v.rect.h <= s.y + 1;
      })
      .toBe(true);
    await sheet.getByRole('button', { name: /^Close / }).first().click();
    // Read in the same task as the click settles: the sheet is either gone or already hidden.
    const state = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="mobile-sheet"]');
      return el ? `${el.getAttribute('aria-hidden')}|${el.hasAttribute('inert')}` : 'gone';
    });
    expect(['true|true', 'gone']).toContain(state);
    await expect(page.getByTestId('mobile-sheet')).toHaveCount(0);
    const v = await attributionVisible(page);
    expect(v).toMatchObject({ inside: true, covered: 0 });
  });
});

test.describe('readout row', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop layout');

  for (const width of [1280, 1920]) {
    test(`R2-M5: the cursor readout never overprints the hint at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await boot(page);
      const row = page.getByTestId('readout-row');
      await expect(row).toBeVisible();
      await page.mouse.move(width / 2, 500);
      await page.mouse.move(width / 2 + 40, 520);
      await expect(row).toHaveAttribute('data-cursor', '', { timeout: 10_000 });
      await expect(page.getByTestId('view-hint')).toBeHidden();
      const fit = await page.evaluate(() => {
        const r = document.querySelector('[data-testid="readout-row"]')!.getBoundingClientRect();
        const coords = document.querySelector('[data-testid="cursor-readout"] > span')!.getBoundingClientRect();
        return coords.width > 0 && coords.right <= r.right + 0.5;
      });
      expect(fit).toBe(true);
    });
  }
});
