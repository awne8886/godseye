import { expect, test, type Page } from '@playwright/test';

/**
 * design-system-hud, Phase 3 round 5. r1 M2: a landscape phone (844×390) was half phone (the JS
 * sheet) and half desktop (`md:` rail, tool strip, status bar); the HUD now follows one `phone:`
 * variant, so each viewport is wholly one layout. r1 M1: conversational palette phrases never plan
 * a route. visual-qa m1/m2: phone credit links and Style Studio knobs are 44 px targets.
 * Each layout test sets its own viewport, so it runs once (desktop project).
 */
test.describe.configure({ timeout: 120_000 });

async function boot(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole('status', { name: /loading/i })).toBeHidden({ timeout: 45_000 });
}

/** Which layout's chrome is on screen. */
async function chrome(page: Page) {
  const shown = (sel: string) => page.locator(sel).first().isVisible();
  return {
    nav: await shown('nav[aria-label="Main"]'),
    rail: await shown('nav[aria-label="Map layers"]'),
    tools: await shown('nav[aria-label="Tools"]'),
    status: await shown('footer[data-map-inset="status-bar"]'),
  };
}

const PHONES = [
  { name: 'landscape phone 844×390', viewport: { width: 844, height: 390 } },
  { name: 'portrait phone 390×844', viewport: { width: 390, height: 844 } },
] as const;

for (const { name, viewport } of PHONES) {
  test.describe(name, () => {
    test.use({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

    test(`r1 M2: ${name} is wholly the phone layout, and the sheet sits on the nav`, async ({ page }, info) => {
      test.skip(info.project.name !== 'desktop', 'sets its own viewport; once');
      await boot(page, '/?layers=&panel=paths');
      expect(await chrome(page)).toEqual({ nav: true, rail: false, tools: false, status: false });
      const sheet = page.getByTestId('mobile-sheet');
      await expect(sheet).toBeVisible();
      // The open sheet rests directly on the nav (tucked under its 1 px top border at most): no dead
      // band where a hidden nav was reserved (the landscape bug left 56 px of empty map there).
      await expect
        .poll(async () => {
          const s = (await sheet.boundingBox())!;
          const n = (await page.locator('nav[aria-label="Main"]').boundingBox())!;
          return Math.round(s.y + s.height - n.y);
        })
        .toBeGreaterThanOrEqual(0);
      const s = (await sheet.boundingBox())!;
      const n = (await page.locator('nav[aria-label="Main"]').boundingBox())!;
      expect(s.y + s.height - n.y).toBeLessThanOrEqual(1);
      await info.attach(`${name}.png`, { body: await page.screenshot(), contentType: 'image/png' });
      // Phone controls: the view bar is top-left with 44 px buttons.
      const bar = (await page.getByTestId('view-controls').boundingBox())!;
      expect(bar.y).toBeLessThan(120);
      for (const b of await page.getByTestId('view-controls').getByRole('button').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    });
  });
}

test.describe('desktop 1600×1000', () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  test('r1 M2: wholly the desktop layout', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'desktop project');
    await boot(page, '/?layers=');
    expect(await chrome(page)).toEqual({ nav: false, rail: true, tools: true, status: true });
    const bar = (await page.getByTestId('view-controls').boundingBox())!;
    expect(bar.x).toBeGreaterThanOrEqual(120);
    expect(bar.y).toBeGreaterThan(500);
  });

  test('r1 M1: "now go to rome" and friends offer no route; real places still do', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'desktop project');
    await boot(page, '/?layers=');
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    const input = palette.getByRole('combobox');
    const plan = palette.getByRole('option', { name: /^Plan route/ });
    for (const q of ['now go to rome', 'I need to drive to paris', 'just go to paris', 'hey fly to rome', 'then zoom to tokyo', 'how do i get to paris']) {
      await input.fill(q);
      await expect(palette.getByText('NO MATCHES').or(palette.getByRole('option').first()), q).toBeVisible();
      await expect(plan, q).toHaveCount(0);
    }
    await input.fill('Hilton Head to Atlanta');
    await expect(plan).toContainText('Plan route HILTON HEAD → ATLANTA');
    await input.fill('now go to rome');
    await expect(plan).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect(page).not.toHaveURL(/[?&]route=/);
  });
});

test.describe('phone targets 390×844', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('visual-qa m1: every credit link is a 44 px target inside the viewport', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'sets its own viewport; once');
    await boot(page, '/?layers=');
    const links = page.locator('.maplibregl-ctrl-attrib a');
    await expect(links.first()).toBeVisible({ timeout: 60_000 });
    for (const a of await links.all()) {
      if (!(await a.isVisible())) continue;
      const box = (await a.boundingBox())!;
      expect(box.height, await a.innerText()).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
    }
    // The credits still sit above the bottom nav, not under it.
    const attrib = (await page.locator('.maplibregl-ctrl-attrib').boundingBox())!;
    const nav = (await page.locator('nav[aria-label="Main"]').boundingBox())!;
    expect(attrib.y + attrib.height).toBeLessThanOrEqual(nav.y + 1);
  });

  test('visual-qa m2: Style Studio AUTO buttons and range inputs are 44 px targets', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'sets its own viewport; once');
    await boot(page, '/?layers=&panel=style-studio');
    const sheet = page.getByTestId('mobile-sheet');
    await expect(sheet.getByTestId('style-studio-sheet')).toBeVisible();
    const autos = sheet.getByRole('button', { name: 'AUTO', exact: true });
    await expect(autos).toHaveCount(10);
    for (const b of await autos.all()) {
      await b.scrollIntoViewIfNeeded();
      const box = (await b.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
    for (const r of await sheet.getByRole('slider').all()) {
      await r.scrollIntoViewIfNeeded();
      expect((await r.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  });
});
