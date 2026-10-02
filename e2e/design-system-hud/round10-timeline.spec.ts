import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { needsBasemap } from '../layers-hazards/helpers';

/**
 * design-system-hud, Phase 3 round 10 MAJOR: the 24 h timeline scrubber (§7, §9 item 2).
 * /api/earthquakes is answered from the recorded fixture (e2e/visual/fixtures/earthquakes.json,
 * 36 USGS quakes observed 5.7–23.4 h before its fetch). Every time in it is moved by the same
 * offset so the fetch is "now" (the relative ages are the recording's, nothing else is changed), so
 * the scrubber's 24 h strip holds the whole recording. Stepping or dragging the cursor back must
 * drop quakes from the map (drawn count and the scrubber's count) and the HUD must stop reading
 * LIVE; one click on LIVE restores the full set. Runs in both projects (desktop strip, phone bar).
 */
test.describe.configure({ timeout: 180_000 });

const FX = fileURLToPath(new URL('../visual/fixtures/', import.meta.url));

interface QuakeFixture {
  meta: { fetchedAt: string; observedAt: string | null; lastGoodAt: string | null } & Record<string, unknown>;
  items: { observedAt: string }[];
}

/** The fixture with every time moved by one offset so that its fetch time is now. */
function quakesFetchedNow(): QuakeFixture {
  const fx = JSON.parse(readFileSync(path.join(FX, 'earthquakes.json'), 'utf8')) as QuakeFixture;
  const offset = Date.now() - Date.parse(fx.meta.fetchedAt);
  const move = (iso: string | null) => (iso ? new Date(Date.parse(iso) + offset).toISOString() : iso);
  fx.meta.fetchedAt = move(fx.meta.fetchedAt)!;
  fx.meta.observedAt = move(fx.meta.observedAt);
  fx.meta.lastGoodAt = move(fx.meta.lastGoodAt);
  for (const q of fx.items) q.observedAt = move(q.observedAt)!;
  return fx;
}

async function open(page: Page) {
  const fx = quakesFetchedNow();
  await page.route(/\/api\/earthquakes(\?|$)/, (route) => route.fulfill({ json: fx }));
  await page.goto('/?layers=earthquakes');
  await needsBasemap(page);
  await expect(page.getByRole('status', { name: /loading/i })).toBeHidden({ timeout: 45_000 });
  return fx.items.length;
}

const shown = (page: Page) => page.getByTestId('timeline-count-earthquakes').getAttribute('data-shown').then(Number);
const drawnTotal = (page: Page) => page.getByTestId('hazards-drawn-earthquakes').getAttribute('data-total').then(Number);

async function expectNotLive(page: Page) {
  await expect(page.getByTestId('telemetry-status')).toContainText('REPLAY');
  await expect(page.getByTestId('telemetry-status')).not.toContainText(/\bLIVE\b/);
  await expect(page.getByTestId('timeline-time')).toHaveText(/^REPLAY \d\d:\d\d UTC$/);
}

test('r10 M: stepping the timeline back drops quakes and leaves LIVE; LIVE restores them', async ({ page }) => {
  const total = await open(page);
  const scrubber = page.getByTestId('timeline-scrubber');
  await expect(scrubber).toBeVisible({ timeout: 60_000 });
  // Live: every recorded quake is drawn and counted (the count chip is desktop-only, the drawn
  // diagnostics are not).
  await expect.poll(() => drawnTotal(page), { timeout: 60_000 }).toBe(total);
  await expect(page.getByTestId('timeline-count-earthquakes')).toHaveAttribute('data-total', String(total));
  await expect(page.getByTestId('telemetry-status')).not.toContainText('REPLAY');
  await expect(page.getByTestId('timeline-time')).toHaveText(/^NOW \d\d:\d\d UTC$/);

  // 12 h back with the keyboard (PageDown = 1 h): the ARIA slider reports it.
  const slider = page.getByRole('slider', { name: 'Timeline cursor' });
  await slider.focus();
  for (let i = 0; i < 12; i++) await slider.press('PageDown');
  await expect(slider).toHaveAttribute('aria-valuenow', '-720');
  await expect(slider).toHaveAttribute('aria-valuetext', /^Replay .* UTC, 12 h ago$/);
  await expectNotLive(page);
  await expect.poll(() => drawnTotal(page)).toBeLessThan(total);
  const at12h = await drawnTotal(page);
  expect(at12h).toBeGreaterThan(0);
  expect(await shown(page)).toBe(at12h);

  // Home: 24 h back, before the oldest recorded quake: nothing is drawn (never padded).
  await slider.press('Home');
  await expect.poll(() => drawnTotal(page)).toBe(0);
  await expectNotLive(page);

  // One click on LIVE: back to now, every quake again.
  await page.getByRole('button', { name: /LIVE/ }).click();
  await expect.poll(() => drawnTotal(page)).toBe(total);
  await expect(page.getByTestId('timeline-time')).toHaveText(/^NOW /);
  await expect(page.getByTestId('telemetry-status')).not.toContainText('REPLAY');
  await expect(slider).toHaveAttribute('aria-valuenow', '0');
});

test('r10 M: dragging the cursor replays; Escape returns live', async ({ page }) => {
  const total = await open(page);
  await expect.poll(() => drawnTotal(page), { timeout: 60_000 }).toBe(total);
  const slider = page.getByRole('slider', { name: 'Timeline cursor' });
  const box = (await slider.boundingBox())!;
  const y = box.y + box.height / 2;
  // Press near the right end, drag to a quarter of the strip (18 h back).
  await page.mouse.move(box.x + box.width * 0.95, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, y, { steps: 4 });
  await page.mouse.move(box.x + box.width * 0.25, y, { steps: 4 });
  await page.mouse.up();
  await expect(slider).toHaveAttribute('aria-valuenow', '-1080');
  await expectNotLive(page);
  await expect.poll(() => drawnTotal(page)).toBeLessThan(total);
  await slider.press('Escape');
  await expect(slider).toHaveAttribute('aria-valuenow', '0');
  await expect.poll(() => drawnTotal(page)).toBe(total);
});
