import { expect, test } from '@playwright/test';
import { gotoMap, MAP } from './helpers';

/**
 * perf B2 / visual-qa R2-M6: start-up GPU work is admitted one unit per quiet slot, but always
 * makes progress (≥ 1 unit per ADMISSION_MAX_WAIT_MS) — the landing view must draw the basemap and
 * its default entity layers under SwiftShader, and the queue must drain.
 */
test.describe('map start-up admission', () => {
  test.describe.configure({ timeout: 180_000 });

  test('landing view: basemap drawn, default entity layers drawn, admission queue drains', async ({ page }) => {
    await page.addInitScript(() => {
      const st = { draws: 0, instanced: 0 };
      (window as unknown as { __draws: typeof st }).__draws = st;
      const P = WebGL2RenderingContext.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
      for (const k of ['drawElements', 'drawArrays', 'drawArraysInstanced', 'drawElementsInstanced']) {
        const o = P[k]!;
        P[k] = function (this: unknown, ...a: unknown[]) {
          st.draws++;
          if (k.endsWith('Instanced')) st.instanced++; // deck primitives draw instanced; MapLibre does not
          return o.apply(this, a);
        };
      }
    });
    await gotoMap(page);
    const draws = () => page.evaluate(() => (window as unknown as { __draws: { draws: number; instanced: number } }).__draws);
    await expect.poll(async () => (await draws()).draws, { timeout: 60_000 }).toBeGreaterThan(0);
    // Entity layers are actually drawn (not only counted)…
    await expect.poll(async () => (await draws()).instanced, { timeout: 120_000 }).toBeGreaterThan(0);
    // …and the queue (feature mount, deck device, layer classes, native layer types) drains.
    await expect(page.locator(MAP)).toHaveAttribute('data-admission-pending', '0', { timeout: 60_000 });
  });
});
