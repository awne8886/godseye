import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { needsBasemap } from '../layers-hazards/helpers';

/**
 * design-system-hud, Phase 3 round 11 MAJOR A: the 24 h timeline strip never covers MapLibre's
 * bottom-right stack (imagery honesty chips + licence credits) and its LIVE button stays on screen.
 * At 1024–1400 px the r10 strip hid the NIGHT LIGHTS / BASEMAP chips and the first credits line and
 * pushed LIVE off a 1024 px viewport; e2e at 1600×1000 missed it, so every width is checked here,
 * with a replay active and all four lanes on. Feeds come from recorded responses (route
 * interception): e2e/visual/fixtures/earthquakes.json and fixtures/{fires,news,gdelt-events}.json
 * (recorded from this server 2026-10-02 23:30 UTC; fires trimmed to the first 400 rows, news to 40
 * items, GDELT to the first 150 items, nothing else changed). Every time is moved by one offset per
 * fixture so its fetch is now (relative ages kept), so the 24 h strip holds the recordings.
 */
test.describe.configure({ timeout: 240_000 });

const read = (p: string) => JSON.parse(readFileSync(join(process.cwd(), p), 'utf8')) as Record<string, unknown>;
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;

/** A copy of `body` with every ISO time (and the fires' epoch-second `seenAt` column) moved so its fetch is now. */
function fetchedNow(body: Record<string, unknown>): Record<string, unknown> {
  const meta = body.meta as { fetchedAt: string };
  const offset = Date.now() - Date.parse(meta.fetchedAt);
  const move = (v: unknown): unknown => {
    if (typeof v === 'string' && ISO.test(v)) return new Date(Date.parse(v) + offset).toISOString();
    if (Array.isArray(v)) return v.map(move);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, move(x)]));
    return v;
  };
  const out = move(body) as Record<string, unknown>;
  const fields = out.fields as string[] | undefined;
  const seen = fields?.indexOf('seenAt') ?? -1;
  if (seen >= 0) out.rows = (out.rows as unknown[][]).map((r) => r.map((c, i) => (i === seen && typeof c === 'number' ? Math.round(c + offset / 1000) : c)));
  return out;
}

const FX = {
  earthquakes: read('e2e/visual/fixtures/earthquakes.json'),
  fires: read('e2e/design-system-hud/fixtures/fires.json'),
  news: read('e2e/design-system-hud/fixtures/news.json'),
  gdelt: read('e2e/design-system-hud/fixtures/gdelt-events.json'),
};

async function serve(page: Page) {
  await page.route(/\/api\/earthquakes(\?|$)/, (r) => r.fulfill({ json: fetchedNow(FX.earthquakes) }));
  await page.route(/\/api\/fires(\?|$)/, (r) => r.fulfill({ json: fetchedNow(FX.fires) }));
  await page.route(/\/api\/news(\?|$)/, (r) => r.fulfill({ json: fetchedNow(FX.news) }));
  await page.route(/\/api\/gdelt-events(\?|$)/, (r) => r.fulfill({ json: fetchedNow(FX.gdelt) }));
}

const LANES = ['earthquakes', 'fires', 'alert_pins', 'gdelt_events'] as const;

async function openReplay(page: Page) {
  await serve(page);
  await page.goto(`/?layers=${LANES.join(',')}`);
  await needsBasemap(page);
  await expect(page.getByRole('status', { name: /loading/i })).toBeHidden({ timeout: 45_000 });
  const strip = page.getByTestId('timeline-scrubber');
  await expect(strip).toBeVisible({ timeout: 60_000 });
  for (const id of LANES) await expect(page.getByTestId(`timeline-lane-${id}`)).toBeAttached();
  await expect(page.locator('.maplibregl-ctrl-attrib-inner')).toBeVisible({ timeout: 30_000 });
  const slider = page.getByRole('slider', { name: 'Timeline cursor' });
  await slider.focus();
  for (let i = 0; i < 6; i++) await slider.press('PageDown');
  await expect(page.getByTestId('timeline-time')).toHaveText(/^REPLAY \d\d:\d\d UTC$/);
  return strip;
}

/** Sample points (inset corners, edge midpoints, centre, and every 24 px along the middle) that resolve to the timeline. */
async function pointsOnTimeline(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const strip = document.querySelector('[data-testid="timeline-scrubber"]');
    const hits: string[] = [];
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const xs = [r.left + 2, r.left + r.width / 2, r.right - 2];
      for (let x = r.left + 2; x < r.right - 2; x += 24) xs.push(x);
      const ys = [r.top + 2, r.top + r.height / 2, r.bottom - 2];
      for (const x of xs)
        for (const y of ys) {
          const hit = document.elementFromPoint(x, y);
          if (hit && strip?.contains(hit)) hits.push(`${sel} ${el.getAttribute('data-testid') ?? ''} @ ${Math.round(x)},${Math.round(y)}`);
        }
    }
    return hits;
  }, selector);
}

for (const [width, height] of [
  [1024, 768],
  [1100, 700],
  [1280, 800],
  [1600, 1000],
] as const) {
  test(`r11 A: ${width}×${height} — the strip clears the credits and imagery chips; LIVE is on screen and clickable`, async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'desktop layout widths (the phone bar is covered below)');
    await page.setViewportSize({ width, height });
    const strip = await openReplay(page);

    // Let a late chip or credits change re-place the strip, then check.
    await expect(page.locator('[data-testid^="imagery-chip"]').first()).toBeVisible({ timeout: 30_000 }).catch(() => undefined);
    await expect.poll(() => pointsOnTimeline(page, '.maplibregl-ctrl-attrib-inner'), { timeout: 10_000 }).toEqual([]);
    await expect.poll(() => pointsOnTimeline(page, '[data-testid^="imagery-chip"]'), { timeout: 10_000 }).toEqual([]);

    const box = (await strip.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);

    const live = page.getByTestId('timeline-live');
    const lb = (await live.boundingBox())!;
    expect(lb.x).toBeGreaterThanOrEqual(0);
    expect(lb.y).toBeGreaterThanOrEqual(0);
    expect(lb.x + lb.width).toBeLessThanOrEqual(width);
    expect(lb.y + lb.height).toBeLessThanOrEqual(height);
    const hitTestable = await live.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && el.contains(hit);
    });
    expect(hitTestable).toBe(true);

    // The header stays one row and the strip keeps its height between replay and live.
    const replayHeight = box.height;
    await live.click();
    await expect(page.getByTestId('timeline-time')).toHaveText(/^NOW \d\d:\d\d UTC$/);
    expect((await strip.boundingBox())!.height).toBe(replayHeight);
    const label = page.getByText('TIMELINE · 24 H');
    const lineHeight = await label.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight) || 15);
    expect((await label.boundingBox())!.height).toBeLessThan(lineHeight * 1.5);
  });
}

test('r11 E: phone bar — the credits sit above the strip, not on its top border', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'phone layout');
  for (const [width, height] of [
    [390, 844],
    [844, 390],
  ] as const) {
    await page.setViewportSize({ width, height });
    await serve(page);
    await page.goto(`/?layers=${LANES.join(',')}`);
    await needsBasemap(page);
    await expect(page.getByRole('status', { name: /loading/i })).toBeHidden({ timeout: 45_000 });
    const strip = page.getByTestId('timeline-scrubber');
    await expect(strip).toBeVisible({ timeout: 60_000 });
    const attrib = page.locator('.maplibregl-ctrl-attrib');
    await expect(attrib).toBeVisible({ timeout: 30_000 });
    const s = (await strip.boundingBox())!;
    const a = (await attrib.boundingBox())!;
    expect(a.y + a.height, `${width}×${height}`).toBeLessThanOrEqual(s.y);
    expect(await pointsOnTimeline(page, '.maplibregl-ctrl-attrib-inner')).toEqual([]);
  }
});
