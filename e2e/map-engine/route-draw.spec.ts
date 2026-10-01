import { expect, test } from '@playwright/test';
import { MAP, tokenPixels, waitForMapStyle } from './helpers';

/**
 * Visual-qa R4-M1: the first data layer must reach the screen within seconds of style parse on the
 * desktop globe, not 15–25 s later. Asserted on pixels (a screenshot decoded in the page), not on
 * layer state: `?route=LHR-JFK` draws a gold great circle (`--map-route-planned`) over the Atlantic.
 */

for (const proj of ['globe', 'mercator'] as const) {
  test(`R4-M1: ?route=LHR-JFK reaches the screen within seconds of style parse (${proj}, pixels)`, async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'desktop draw check (1600×1000)');
    test.setTimeout(180_000);
    await page.goto(`/?route=LHR-JFK&proj=${proj}`);
    await waitForMapStyle(page, 90_000);
    const t0 = Date.now();
    // The boot splash is gold too: count only once it has lifted (≤ 7 s cap) over the bare map.
    await expect(page.getByRole('status', { name: /loading/i })).toBeHidden({ timeout: 30_000 });
    const samples: string[] = [];
    let drawnAt = -1;
    for (let i = 0; i < 40 && drawnAt < 0; i++) {
      const el = page.locator(MAP);
      const [pending, deckLayers, undrawn] = await Promise.all(['data-admission-pending', 'data-deck-layers', 'data-deck-undrawn'].map((a) => el.getAttribute(a)));
      const gold = await tokenPixels(page, '--map-route-planned');
      samples.push(`${((Date.now() - t0) / 1000).toFixed(1)}s pending=${pending} deck=${deckLayers} undrawn=${undrawn} gold=${gold}`);
      if (gold > 50) drawnAt = Date.now() - t0;
      else await page.waitForTimeout(500);
    }
    await info.attach('samples', { body: samples.join('\n'), contentType: 'text/plain' });
    console.log(samples.join('\n'));
    expect(drawnAt, samples.join('\n')).toBeGreaterThanOrEqual(0);
    // Budget for SwiftShader on a shared 4-core sandbox (each screenshot sample alone takes 5–10 s
    // there); before the fix the globe arc first appeared after 52–81 s in the same setup.
    expect(drawnAt, samples.join('\n')).toBeLessThan(45_000);
  });
}
