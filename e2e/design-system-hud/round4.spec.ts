import { expect, test, type Page } from '@playwright/test';

/**
 * design-system-hud, Phase 3 round 4: palette route parsing is position-aware (R1 m4), a tool click
 * is answered at once (R1 m9) and the phone Style Studio sheet has one header row without a
 * meaningless STANDBY chip (visual-qa m4). The perf items (m-c, m-d) are pinned by unit tests in
 * src/components/hud/round4.test.tsx.
 */
test.describe.configure({ timeout: 120_000 });

async function boot(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole('status', { name: /loading/i })).toBeHidden({ timeout: 45_000 });
}

test.describe('desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop layout');

  test('R1 m4: the palette plans real places whose names start with filler words, never "drive to paris"', async ({ page }) => {
    await boot(page, '/?layers=');
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    const input = palette.getByRole('combobox');
    const plan = palette.getByRole('option', { name: /^Plan route/ });
    for (const [q, label] of [
      ['Can Tho to Hanoi', 'Plan route CAN THO → HANOI'],
      ['In Salah to Algiers', 'Plan route IN SALAH → ALGIERS'],
      ['Hilton Head to Atlanta', 'Plan route HILTON HEAD → ATLANTA'],
      ['Show Low to Phoenix', 'Plan route SHOW LOW → PHOENIX'],
      ['London to New York', 'Plan route LONDON → NEW YORK'],
    ] as const) {
      await input.fill(q);
      await expect(plan, q).toHaveCount(1);
      await expect(plan, q).toContainText(label);
    }
    await input.fill('drive to paris');
    // The list has answered this query (no matches at all, or fuzzy ones) and none of it plans a flight.
    await expect(palette.getByText('NO MATCHES').or(palette.getByRole('option').first())).toBeVisible();
    await expect(plan).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect(page).not.toHaveURL(/[?&]route=/);
    // "fly from …" strips only the verb phrase; Enter plans Can Tho → Hanoi in PATHS.
    await input.fill('fly from Can Tho to Hanoi');
    await expect(plan).toContainText('Plan route CAN THO → HANOI');
    await page.keyboard.press('Enter');
    await expect(palette).toBeHidden();
    await expect(page.getByRole('region', { name: 'PATHS' })).toBeVisible();
    await expect(page).toHaveURL(/[?&]route=VCA-HAN\b/, { timeout: 20_000 });
  });

  test('R1 m9: a tool click opens its panel in well under a second (no chunk wait, no map re-render)', async ({ page }) => {
    await boot(page, '/?layers=');
    const strip = page.getByRole('navigation', { name: 'Tools' });
    const first = strip.getByRole('button').first();
    const name = (await first.getAttribute('aria-label'))!;
    await first.hover(); // warms the panel's chunk, like a visitor's pointer on the way to the click
    // Time from the click's pointerdown to the panel region being in the DOM, measured in the page.
    const ms = await page.evaluate(async (label) => {
      const btn = document.querySelector<HTMLButtonElement>(`nav[aria-label="Tools"] button[aria-label="${label}"]`)!;
      const t0 = performance.now();
      btn.click();
      return await new Promise<number>((resolve) => {
        const done = () => [...document.querySelectorAll('section[aria-labelledby]')].some((s) => s.querySelector('h2')?.textContent === label);
        if (done()) return resolve(performance.now() - t0);
        const mo = new MutationObserver(() => {
          if (done()) {
            mo.disconnect();
            resolve(performance.now() - t0);
          }
        });
        mo.observe(document.body, { childList: true, subtree: true });
      });
    }, name);
    await expect(page.getByRole('region', { name, exact: true })).toBeVisible();
    expect(ms).toBeLessThan(1000);
  });
});

test.describe('phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone layout');

  // r7 m reverses the m4 placement: the tools sit at the top of the sheet body so the tab strip keeps
  // its width on a 390 px phone; there is still one header row (tabs + close) and no STANDBY chip.
  test('visual-qa m4: the Style Studio sheet has one header row and no STANDBY chip; its tools are 44 px', async ({ page }) => {
    await boot(page, '/?layers=&panel=style-studio');
    const sheet = page.getByTestId('mobile-sheet');
    await expect(sheet.getByTestId('style-studio-sheet')).toBeVisible();
    const headers = sheet.locator('header');
    await expect(headers).toHaveCount(1);
    const header = headers.first();
    for (const name of ['Import theme JSON from clipboard', 'Copy theme JSON', 'Reset custom edits', 'Close STYLE STUDIO']) {
      const b = (name.startsWith('Close') ? header : sheet.getByTestId('style-studio-sheet')).getByRole('button', { name, exact: true });
      await expect(b, name).toBeVisible();
      const box = (await b.boundingBox())!;
      expect(box.height, name).toBeGreaterThanOrEqual(44);
    }
    await expect(sheet.locator('.instrument-chip')).toHaveCount(0);
    await expect(sheet.getByText('STANDBY', { exact: true })).toHaveCount(0);
    // The preset grid starts right under the header row and the one 44 px tool row.
    const headerBox = (await header.boundingBox())!;
    const presets = (await sheet.getByRole('radiogroup', { name: 'Theme preset' }).boundingBox())!;
    expect(presets.y - (headerBox.y + headerBox.height)).toBeLessThan(130);
  });
});
