import { expect, test, type Page } from '@playwright/test';
import { MAP, tokenPixels, waitForMapStyle } from './helpers';

/**
 * Visual-qa R4-M1 / CI globe first draw: the user's route must reach the screen within seconds of
 * style parse on the desktop globe. Asserted on pixels (a screenshot decoded in the page), not on
 * layer state: `?route=LHR-JFK` draws a dashed gold great circle (`--map-route-planned`, alpha 0.6
 * over a 15 % glow) over the Atlantic. `tokenPixels` counts the token blended over the dark globe,
 * so the arc itself is measured — not the comet head sweeping along it (which the old opaque-only
 * rule depended on, missing the drawn arc in 10 of 32 screenshots and forever under reduced motion).
 */

/** Arc pixels in the clip once it is drawn: 538–1030 measured (desktop 1600×1000); the comet alone is ≈ 110. */
const ARC_MIN_PX = 300;
const ATTRS = ['data-admission-pending', 'data-deck-layers', 'data-deck-undrawn', 'data-deck-classes', 'data-admission-log'] as const;

async function readAttrs(page: Page) {
  const el = page.locator(MAP);
  const [pending, deck, undrawn, classes, log] = await Promise.all(ATTRS.map((a) => el.getAttribute(a)));
  return { pending, deck: Number(deck ?? 0), undrawn, classes, log };
}

for (const proj of ['globe', 'mercator'] as const) {
  test(`R4-M1: ?route=LHR-JFK reaches the screen within seconds of style parse (${proj}, pixels)`, async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'desktop draw check (1600×1000)');
    test.setTimeout(180_000);
    await page.goto(`/?route=LHR-JFK&proj=${proj}`);
    await waitForMapStyle(page, 90_000);
    const t0 = Date.now();
    const at = () => ((Date.now() - t0) / 1000).toFixed(1);
    // The boot splash is gold too: count only once it has lifted (≤ 7 s cap) over the bare map.
    await expect(page.getByRole('status', { name: /loading/i })).toBeHidden({ timeout: 30_000 });
    const samples: string[] = [`${at()}s splash lifted`];
    let drawnAt = -1;
    let lastState = '';
    while (drawnAt < 0 && Date.now() - t0 < 120_000) {
      const a = await readAttrs(page);
      const state = `pending=${a.pending} deck=${a.deck} undrawn=${a.undrawn} classes=${a.classes ?? ''}`;
      // No deck layer in the style yet: the arc cannot be on screen, and a SwiftShader screenshot
      // costs 4–20 s. Poll the cheap DOM state instead; the verdict is always taken on pixels.
      if (!a.deck || a.undrawn !== '0') {
        if (state !== lastState) samples.push(`${at()}s ${state} (no deck layer in the style yet)`);
        lastState = state;
        await page.waitForTimeout(250);
        continue;
      }
      const shotStart = Date.now();
      const gold = await tokenPixels(page, '--map-route-planned');
      // Stamped when the screenshot has been taken: the arc was on screen by then (an upper bound).
      const t = Date.now() - t0;
      samples.push(`${(t / 1000).toFixed(1)}s ${state} gold=${gold} shot=${Date.now() - shotStart}ms admitted=[${a.log ?? ''}]`);
      if (gold >= ARC_MIN_PX) drawnAt = t;
      else await page.waitForTimeout(250);
    }
    await info.attach('samples', { body: samples.join('\n'), contentType: 'text/plain' });
    console.log(`${proj}\n${samples.join('\n')}`);
    expect(drawnAt, samples.join('\n')).toBeGreaterThanOrEqual(0);
    // Budget (unchanged) for SwiftShader on a shared 4-core sandbox / the CI runner, where the splash
    // and each screenshot alone take 4–20 s. Measured on a production build in the sandbox: before
    // the route-first admission the globe arc's first draw call came 15–25 s after style parse
    // (median 19 s, 9 runs; CI: on screen after 35–65 s); with it 6.9–7.4 s, and this spec reported
    // 16.4–32.2 s (globe) and 6.3–12.4 s (mercator) in 3 consecutive runs.
    expect(drawnAt, samples.join('\n')).toBeLessThan(45_000);
  });
}

test('control: without a route the same view counts (almost) no route-gold pixels (globe, default layers)', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'desktop draw check (1600×1000)');
  test.setTimeout(180_000);
  // The camera the LHR–JFK fit settles on (desktop 1600×1000 globe, read from data-camera), with
  // every default layer (earthquakes, incidents, satellites, night lights…) drawn: none of it may
  // pass for the route, so a pass above means the arc.
  await page.goto('/?proj=globe&c=52.2152,-41.3066,3.39');
  await waitForMapStyle(page, 90_000);
  await expect(page.getByRole('status', { name: /loading/i })).toBeHidden({ timeout: 30_000 });
  await expect(page.locator(MAP)).toHaveAttribute('data-admission-pending', '0', { timeout: 120_000 });
  await expect(page.locator(MAP)).toHaveAttribute('data-deck-undrawn', '0', { timeout: 30_000 });
  const gold = await tokenPixels(page, '--map-route-planned');
  console.log(`control gold=${gold}`);
  expect(gold).toBeLessThan(ARC_MIN_PX / 3);
});
