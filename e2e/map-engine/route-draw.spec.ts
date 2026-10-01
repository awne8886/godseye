import { expect, test, type Page } from '@playwright/test';
import { MAP, tokenPixels, waitForMapStyle, watchTokenFrames } from './helpers';

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
 * 51 s for an arc admitted 11 s after navigation. The screencast starts before navigation, so the
 * first frame with the arc is never missed; a frame counts only once it was produced after both
 * the style parse and the splash removal (in-page times), and at most `SPLASH_MIN_PX` gold pixels
 * (the boot splash wordmark is gold too: ≈ 2880 px in the clip). Gold seen before the style parse
 * (a ≈ 232 px element on slow style fetches, see `tokenPixels`) never counts.
 */

/** Arc pixels in the clip once it is drawn: 713–1043 measured (desktop 1600×1000); the comet alone is ≈ 110. */
const ARC_MIN_PX = 300;
/** Frames above this are not the arc (splash wordmark ≈ 2880 px; the arc at most ≈ 1100 with its comet). */
const SPLASH_MIN_PX = 1500;
const ATTRS = ['data-admission-pending', 'data-deck-layers', 'data-deck-undrawn', 'data-deck-classes', 'data-admission-log'] as const;

interface BootTimes {
  styleReady?: number;
  splashGone?: number;
}
type BootKey = keyof BootTimes;

/**
 * Init script: wall-clock times of style parse and splash removal, recorded as they happen and
 * reported to the test through the exposed `__godseyeBoot` binding (delivery may lag; the times
 * do not).
 */
function recordBootTimes() {
  const rec: BootTimes = {};
  const w = window as unknown as { __bootTimes: BootTimes; __godseyeBoot?: (k: BootKey, t: number) => void };
  w.__bootTimes = rec;
  const now = () => performance.timeOrigin + performance.now();
  const set = (k: BootKey) => {
    rec[k] = now();
    w.__godseyeBoot?.(k, rec[k]);
  };
  let splashSeen = false;
  const check = () => {
    if (rec.styleReady === undefined && document.querySelector('.maplibregl-map[data-style-ready="true"]')) set('styleReady');
    if (document.querySelector('[role="status"][aria-label*="loading" i]')) splashSeen = true;
    else if (splashSeen && rec.splashGone === undefined) set('splashGone');
    if (rec.styleReady !== undefined && rec.splashGone !== undefined) observer.disconnect();
  };
  const observer = new MutationObserver(check);
  const start = () => observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-style-ready'] });
  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start);
}

/**
 * Init script: `Date` (only `Date`: timers, `performance` and the compositor clock stay real)
 * shifted to the nearest instant at `utcHour`:00 UTC, so the day/night terminator and the Black
 * Marble night side are drawn as at that hour. Test-only.
 */
function shiftDateToUtcHour(utcHour: number) {
  const RealDate = Date;
  const real = RealDate.now();
  const d = new RealDate(real);
  let delta = RealDate.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), utcHour) - real;
  if (delta > 12 * 3_600_000) delta -= 24 * 3_600_000;
  if (delta < -12 * 3_600_000) delta += 24 * 3_600_000;
  class ShiftedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(RealDate.now() + delta);
      else super(...(args as [string]));
    }
    static override now() {
      return RealDate.now() + delta;
    }
  }
  (window as unknown as { Date: DateConstructor }).Date = ShiftedDate as unknown as DateConstructor;
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
    const boot: BootTimes = {};
    let bootReported: () => void = () => undefined;
    const bothReported = new Promise<void>((r) => (bootReported = r));
    await page.exposeFunction('__godseyeBoot', (k: BootKey, t: number) => {
      boot[k] = t;
      if (boot.styleReady !== undefined && boot.splashGone !== undefined) bootReported();
    });
    await page.addInitScript(recordBootTimes);
    const watch = await watchTokenFrames(page, '--map-route-planned', { minPx: ARC_MIN_PX, maxPx: SPLASH_MIN_PX });
    try {
      await page.goto(`/?route=LHR-JFK&proj=${proj}`);
      await waitForMapStyle(page, 90_000);
      // Splash removal as the test sees it: the fallback gate if the page never reported it (a
      // late notice only makes the result later, never earlier).
      await expect(page.getByRole('status', { name: /loading/i })).toBeHidden({ timeout: 30_000 });
      const testSawSplashGone = Date.now();
      const gate = Promise.race([bothReported, new Promise<void>((r) => setTimeout(r, 5_000))]).then(() => Math.max(boot.styleReady ?? testSawSplashGone, boot.splashGone ?? testSawSplashGone));
      const frame = await watch.first(gate, 120_000);
      const styleReady = boot.styleReady;
      const drawnAt = frame && styleReady !== undefined ? frame.epochMs - styleReady : -1;
      const rel = (t: number | undefined) => (t === undefined || styleReady === undefined ? '—' : secs(t - styleReady));
      const report = [
        `${proj}: style parsed → splash removed ${rel(boot.splashGone)}`,
        frame
          ? `first frame with the arc ${rel(frame.epochMs)} (${frame.px} px; frame ${frame.frames}, best eligible before ${frame.maxBefore} px, best before style+splash ${frame.maxEarly} px, ${frame.overMax} over ${SPLASH_MIN_PX} px)`
          : 'no frame with the arc',
        await readAttrs(page),
      ].join('\n');
      await info.attach('samples', { body: report, contentType: 'text/plain' });
      console.log(report);
      expect(frame, report).not.toBeNull();
      expect(styleReady, report).toBeDefined();
      // Budget (unchanged) for SwiftShader on a shared 4-core sandbox / the CI runner. Measured on
      // a production build in the sandbox: before the route-first admission the globe arc's first
      // draw call came 15–25 s after style parse (median 19 s, 9 runs; CI: on screen after 35–65 s);
      // with it on screen ≈ 10 s after style parse (median; 9.4–19.9 s over 6 independent samples).
      expect(drawnAt, report).toBeLessThan(45_000);
    } finally {
      await watch.stop();
    }
  });
}

/**
 * Controls: the camera the LHR–JFK fit settles on (desktop 1600×1000 globe, read from
 * data-camera), every default layer drawn (earthquakes, incidents, satellites, day/night with the
 * Black Marble night lights…), no route. None of it may pass for the route, so a count above
 * ARC_MIN_PX in the route specs means at least 2/3 of it is the arc. Dim city lights blend like
 * the gold token at alpha ≈ 0.4, so the count depends on the hour: the second control pins `Date`
 * to 03:00 UTC, when the whole clip (UK, North Atlantic, US east coast) is on the night side — the
 * worst case for any hour the suite runs at.
 */
for (const when of ['now', 'night'] as const) {
  test(`control: without a route the same view counts (almost) no route-gold pixels (globe, default layers, ${when === 'now' ? 'current time' : '03:00 UTC: clip on the night side'})`, async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'desktop draw check (1600×1000)');
    test.setTimeout(180_000);
    if (when === 'night') await page.addInitScript(shiftDateToUtcHour, 3);
    await page.goto('/?proj=globe&c=52.2152,-41.3066,3.39');
    await waitForMapStyle(page, 90_000);
    await expect(page.getByRole('status', { name: /loading/i })).toBeHidden({ timeout: 30_000 });
    await expect(page.locator(MAP)).toHaveAttribute('data-admission-pending', '0', { timeout: 120_000 });
    await expect(page.locator(MAP)).toHaveAttribute('data-deck-undrawn', '0', { timeout: 30_000 });
    if (when === 'night') {
      // The night side is drawn: the Black Marble layer is credited and its tiles had time to land.
      await expect(page.getByText(/BLACK MARBLE/).first()).toBeAttached({ timeout: 30_000 });
      await page.waitForTimeout(5_000);
    }
    const gold = await tokenPixels(page, '--map-route-planned');
    await page.screenshot({ path: info.outputPath(`control-${when}.png`) });
    console.log(`control (${when}) gold=${gold}`);
    expect(gold).toBeLessThan(ARC_MIN_PX / 3);
  });
}
