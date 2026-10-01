import { expect, test, type Page } from '@playwright/test';
import { gotoMap, MAP, waitForAdmissionDrained, waitForMapStyle } from './helpers';

/**
 * Phase 3 round-5 map-engine regressions: BASEMAP LOADING from the first frame (visual-qa m3),
 * imagery holes announced (visual-qa m10), hover picking on a budget (perf m-h) and data fetched
 * while the GPU start-up waits (perf m-l). Desktop only (pointer hover; same code on phones).
 */
test.describe('map-engine round 5', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop');
  test.describe.configure({ timeout: 240_000 });

  test('m3: BASEMAP LOADING shows from the first frame (before the style arrives) until the basemap has painted', async ({ page }) => {
    // Hold the style for 6 s and every basemap tile for good: the map is blank all along.
    await page.route(/tiles\.openfreemap\.org\/styles\/dark/, async (route) => {
      await new Promise((r) => setTimeout(r, 6000));
      await route.continue();
    });
    await page.route(/tiles\.openfreemap\.org\/planet\/.+\.pbf/, () => undefined);
    await page.goto('/?layers=&c=48.85,2.35,5');
    // Before MapLibre exists: the pending map area already says so.
    await expect(page.getByTestId('imagery-chip-basemap-loading')).toHaveText('BASEMAP LOADING', { timeout: 30_000 });
    await expect(page.locator(MAP)).toHaveCount(0);
    // Map up, style parsed, no tile painted: still LOADING (neutral), well before the 10 s stall chip.
    await waitForMapStyle(page, 60_000);
    await expect(page.locator(MAP)).toHaveAttribute('data-basemap-state', /loading|stalled/);
    await expect(page.getByText(/BASEMAP LOADING/)).toBeVisible();
  });

  test('m3: the LOADING chip goes away once the basemap has painted', async ({ page }) => {
    await gotoMap(page, { camera: { lat: 48.85, lng: 2.35, zoom: 4 }, params: { layers: '' } });
    await expect(page.locator(MAP)).toHaveAttribute('data-basemap-state', /^(ok|incomplete|offline|stalled)$/, { timeout: 90_000 });
    await expect(page.getByTestId('imagery-chip-basemap-loading')).toHaveCount(0);
  });

  test('m10: holes in the GIBS true-colour overlay are announced on its chip', async ({ page }) => {
    // Half of the GIBS true-colour tiles fail at the network (as the sandbox proxy did); the rest load.
    await page.route(/gibs\.earthdata\.nasa\.gov\/.+VIIRS_SNPP_CorrectedReflectance_TrueColor\/.+\/(\d+)\/(\d+)\/(\d+)\.jpg/, (route) => {
      const m = route.request().url().match(/\/(\d+)\/(\d+)\/(\d+)\.jpg$/)!;
      return Number(m[3]) % 2 === 1 ? route.abort('failed') : route.continue();
    });
    await gotoMap(page, { camera: { lat: 20, lng: 10, zoom: 3 }, params: { layers: 'gibs_truecolor' } });
    const chip = page.getByTestId('imagery-chip-gibs');
    await expect(chip).toHaveText(/^VIIRS TRUE COLOUR \d{4}-\d{2}-\d{2} · REFERENCE · (\d+ TILES? MISSING|SOURCE OFFLINE.*)$/, { timeout: 90_000 });
    await expect(chip).toHaveAttribute('data-tone', 'offline');
  });

  test('m-h: hover picks stay within budget and a drag runs none', async ({ page }) => {
    test.setTimeout(360_000); // every default layer drawn first, then 10 s of hovering on a software GPU
    await countReadPixels(page);
    await gotoMap(page, { camera: { lat: 30, lng: 0, zoom: 2.2 } });
    await waitForMapStyle(page);
    await waitForAdmissionDrained(page);
    const box = (await page.locator('canvas.maplibregl-canvas').boundingBox())!;
    const cx = box.x + box.width * 0.4;
    const cy = box.y + box.height / 2;
    // Drag: no hover pick while the button is held.
    await page.mouse.move(cx - 150, cy);
    await page.waitForTimeout(500);
    await page.mouse.down();
    const d0 = await readPixels(page);
    for (let i = 0; i < 4; i++) await page.mouse.move(cx + (i % 2 ? -150 : 150), cy + 10, { steps: 30 });
    const d1 = await readPixels(page);
    await page.mouse.up();
    expect(d1.n - d0.n).toBe(0);
    await page.waitForTimeout(3000);
    // Hover: the pointer keeps moving for 10 s.
    const h0 = await readPixels(page);
    const t0 = Date.now();
    let dir = 1;
    while (Date.now() - t0 < 10_000) {
      await page.mouse.move(cx + 200 * dir, cy - 100 * dir, { steps: 40 });
      dir = -dir;
    }
    const h1 = await readPixels(page);
    const wall = Date.now() - t0;
    // ≤ 10 Hz, and ≤ 25 % of the main thread (+ slack for timing): before, one pick per frame (90 %).
    expect(h1.n - h0.n).toBeLessThanOrEqual(Math.ceil(wall / 100) + 2);
    expect((h1.ms - h0.ms) / wall).toBeLessThan(0.4);
  });

  test('m-l: data requests start at style parse, before any GPU start-up unit is admitted', async ({ page }) => {
    // Hold the basemap tiles for 8 s so the GPU start-up waits for the paint cap: the window is wide.
    await page.route(/tiles\.openfreemap\.org\/planet\/.+\.pbf/, async (route) => {
      await new Promise((r) => setTimeout(r, 8000));
      await route.continue().catch(() => undefined);
    });
    /** Samples where a non-zero count reads as drawn ("N ENTITIES") while GPU work is still queued. */
    const dishonest: string[] = [];
    let previousDishonest = false;
    await page.goto('/?c=48.85,2.35,4');
    await waitForMapStyle(page, 90_000);
    const t0 = Date.now();
    let firstAdmit = Number.NaN;
    while (Date.now() - t0 < 90_000) {
      const s = await page.evaluate((sel) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        const label = document.querySelector('[data-testid="telemetry-entities"]')?.textContent ?? '';
        return { pending: el?.dataset.admissionPending ?? '', undrawn: el?.dataset.deckUndrawn ?? '0', log: el?.dataset.admissionLog ?? '', label };
      }, MAP);
      // Header honesty while the GPU work waits (two samples in a row: not a render in flight).
      const queued = (s.pending !== '' && s.pending !== '0') || s.undrawn !== '0';
      const bad = queued && /^[1-9][\d,]* ENTITIES$/.test(s.label);
      if (bad && previousDishonest) dishonest.push(`${s.pending}|${s.undrawn}|${s.label}`);
      previousDishonest = bad;
      if (s.log && Number.isNaN(firstAdmit)) firstAdmit = Number(s.log.split(' ')[0]!.split('@')[1]);
      if (s.log && s.pending === '0') break;
      await page.waitForTimeout(250);
    }
    expect(Number.isFinite(firstAdmit)).toBe(true);
    const firstData = await page.evaluate(() => {
      const e = performance.getEntriesByType('resource').find((r) => /\/api\/(earthquakes|gdacs|cables)(\?|$)/.test(new URL(r.name).pathname + new URL(r.name).search));
      return e ? e.startTime : Number.NaN;
    });
    expect(Number.isFinite(firstData)).toBe(true);
    expect(firstData).toBeLessThan(firstAdmit);
    expect(dishonest).toEqual([]);
  });
});

async function countReadPixels(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const st = { n: 0, ms: 0 };
    (window as unknown as { __rp: typeof st }).__rp = st;
    const P = WebGL2RenderingContext.prototype as unknown as { readPixels: (...a: unknown[]) => unknown };
    const o = P.readPixels;
    P.readPixels = function (this: unknown, ...a: unknown[]) {
      const t = performance.now();
      const r = o.apply(this, a);
      st.n++;
      st.ms += performance.now() - t;
      return r;
    };
  });
}

function readPixels(page: Page): Promise<{ n: number; ms: number }> {
  return page.evaluate(() => ({ ...(window as unknown as { __rp: { n: number; ms: number } }).__rp }));
}
