import { expect, test, type Page } from '@playwright/test';
import { firstTokenFrame, MAP, tokenPixels, waitForMapStyle } from './helpers';

/**
 * Visual-qa R4-M1 / CI globe first draw: the user's route must reach the screen within seconds of
 * style parse on the desktop globe. Asserted on pixels, not on layer state: `?route=LHR-JFK` draws
 * a dashed gold great circle (`--map-route-planned`, alpha 0.6 over a 15 % glow) over the Atlantic.
 * `tokenPixels`' rule counts the token blended over the dark globe, so the arc itself is measured —
 * not the comet head sweeping along it (which the old opaque-only rule depended on, missing the
 * drawn arc in 10 of 32 screenshots and forever under reduced motion).
 *
 * Timing: the time the compositor produced the first frame with the arc (CDP screencast, decoded
 * in the test) minus the time the page parsed the style (recorded in the page), so neither
 * depends on how fast a main thread kept busy by a software GPU answers the test: the forced
 * screenshots and attribute reads this spec used to poll took 4–22 s each there and once reported
 * 51 s for an arc admitted 11 s after navigation. Frames are taken from when the splash (gold too)
 * is gone, as the test sees it — a late notice only makes the result later, never earlier.
 */

/** Arc pixels in the clip once it is drawn: 713–1043 measured (desktop 1600×1000); the comet alone is ≈ 110. */
const ARC_MIN_PX = 300;
const ATTRS = ['data-admission-pending', 'data-deck-layers', 'data-deck-undrawn', 'data-deck-classes', 'data-admission-log'] as const;

interface BootTimes {
  styleReady?: number;
  splashGone?: number;
}

/** Init script: wall-clock times of style parse and splash removal, recorded as they happen. */
function recordBootTimes() {
  const rec: BootTimes = {};
  (window as unknown as { __bootTimes: BootTimes }).__bootTimes = rec;
  const now = () => performance.timeOrigin + performance.now();
  let splashSeen = false;
  const check = () => {
    if (rec.styleReady === undefined && document.querySelector('.maplibregl-map[data-style-ready="true"]')) rec.styleReady = now();
    if (document.querySelector('[role="status"][aria-label*="loading" i]')) splashSeen = true;
    else if (splashSeen && rec.splashGone === undefined) rec.splashGone = now();
    if (rec.styleReady !== undefined && rec.splashGone !== undefined) observer.disconnect();
  };
  const observer = new MutationObserver(check);
  const start = () => observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-style-ready'] });
  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start);
}

async function readAttrs(page: Page) {
  const el = page.locator(MAP);
  const [pending, deck, undrawn, classes, log] = await Promise.all(ATTRS.map((a) => el.getAttribute(a)));
  return `pending=${pending} deck=${deck} undrawn=${undrawn} classes=${classes ?? ''} admitted=[${log ?? ''}]`;
}

const secs = (ms: number | undefined) => (ms === undefined ? '—' : `${(ms / 1000).toFixed(1)}s`);

for (const proj of ['globe', 'mercator'] as const) {
  test(`R4-M1: ?route=LHR-JFK reaches the screen within seconds of style parse (${proj}, pixels)`, async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'desktop draw check (1600×1000)');
    test.setTimeout(180_000);
    await page.addInitScript(recordBootTimes);
    await page.goto(`/?route=LHR-JFK&proj=${proj}`);
    await waitForMapStyle(page, 90_000);
    // The boot splash is gold too: frames count only once it has lifted (≤ 7 s cap; noticing it
    // can take longer on a busy software GPU, which only delays the frames counted).
    await expect(page.getByRole('status', { name: /loading/i })).toBeHidden({ timeout: 30_000 });
    const frame = await firstTokenFrame(page, '--map-route-planned', { minPx: ARC_MIN_PX, timeoutMs: 120_000 });
    const boot = await page.evaluate(() => (window as unknown as { __bootTimes?: BootTimes }).__bootTimes ?? {});
    const styleReady = boot.styleReady;
    const drawnAt = frame && styleReady !== undefined ? frame.epochMs - styleReady : -1;
    const rel = (t: number | undefined) => (t === undefined || styleReady === undefined ? '—' : secs(t - styleReady));
    const report = [
      `${proj}: style parsed → splash removed ${rel(boot.splashGone)}`,
      frame ? `first frame with the arc ${rel(frame.epochMs)} (${frame.px} px; ${frame.frames} frames decoded, best before ${frame.maxBefore} px)` : 'no frame with the arc',
      await readAttrs(page),
    ].join('\n');
    await info.attach('samples', { body: report, contentType: 'text/plain' });
    console.log(report);
    expect(frame, report).not.toBeNull();
    expect(styleReady, report).toBeDefined();
    // Budget (unchanged) for SwiftShader on a shared 4-core sandbox / the CI runner. Measured on a
    // production build in the sandbox: before the route-first admission the globe arc's first
    // draw call came 15–25 s after style parse (median 19 s, 9 runs; CI: on screen after 35–65 s);
    // with it 6.9–7.4 s, on screen 8.6–9.6 s after style parse (CDP screencast).
    expect(drawnAt, report).toBeLessThan(45_000);
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
