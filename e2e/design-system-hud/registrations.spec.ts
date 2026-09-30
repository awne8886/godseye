import { expect, test, type Page } from '@playwright/test';

/**
 * design-system-hud × wave A registrations: the panel host and card host open what the feature
 * modules registered (SPACE tool, Flight Watch panel, aircraft and earthquake cards) inside the
 * HUD frame (title, close, source / observed / freshness). Live-data tests skip honestly when the
 * upstream answers SOURCE OFFLINE.
 */
test.describe.configure({ timeout: 180_000 });

async function boot(page: Page, url: string) {
  await page.goto(url);
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole('status', { name: /loading/i })).toBeHidden({ timeout: 30_000 });
}

/** The card frame shows the provider, an observation time and a freshness badge, and closes. */
async function expectCardFrame(page: Page, kind: RegExp) {
  const frame = page.getByRole('region', { name: kind }).filter({ has: page.getByRole('button', { name: 'Close card' }) });
  await expect(frame).toBeVisible();
  await expect(frame).toContainText('SOURCE');
  await expect(frame).toContainText('OBSERVED');
  await expect(frame.locator('[data-state]').first()).toHaveText(/LIVE|STALE|OFFLINE|UNTIMED|REFERENCE|\d+[smhd]/);
  await frame.getByRole('button', { name: 'Close card' }).click();
  await expect(frame).toBeHidden();
}

/** Click the map centre until something selects (the first click can land before the layer draws). */
async function clickCentreUntil(page: Page, done: () => Promise<boolean>) {
  const box = (await page.locator('canvas.maplibregl-canvas').boundingBox())!;
  for (let i = 0; i < 6; i++) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    if (await done()) return true;
    await page.waitForTimeout(2000);
  }
  return false;
}

test('SPACE tool opens the registered SPACE panel in the instrument frame', async ({ page, isMobile }) => {
  await boot(page, '/');
  if (isMobile) {
    // The MARKETS tab's sheet holds MARKETS and SPACE; with MARKETS not deployed SPACE opens directly.
    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'MARKETS' }).click();
    const tab = page.getByRole('tablist', { name: 'Sheet sections' }).getByRole('tab', { name: 'SPACE' });
    if (await tab.count()) await tab.click();
  } else {
    const tool = page.getByRole('navigation', { name: 'Tools' }).getByRole('button', { name: 'SPACE', exact: true });
    await expect(tool).toHaveAttribute('title', 'Live from Space — 24/7 video downlink from the ISS');
    await tool.click();
    await expect(tool).toHaveAttribute('aria-pressed', 'true');
  }
  const panel = page.getByRole('region', { name: 'SPACE', exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('space-panel')).toBeVisible();
  await panel.getByRole('button', { name: 'Close SPACE' }).click();
  await expect(panel).toBeHidden();
});

test('Flight Watch opens from ?panel= and closes with ESC', async ({ page, isMobile }) => {
  await boot(page, '/?panel=flight-watch');
  const panel = page.getByRole('region', { name: 'FLIGHT WATCH', exact: true });
  await expect(panel).toBeVisible();
  if (!isMobile) {
    const box = (await panel.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(320);
  }
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
});

test('an earthquake card opens in the HUD card frame', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop pointer test');
  const res = await page.request.get('/api/earthquakes');
  test.skip(res.status() === 503, 'USGS is SOURCE OFFLINE right now');
  const body = (await res.json()) as { items: { lat: number; lng: number; magnitude: number }[] };
  test.skip(!body.items?.length, 'no quakes in the feed');
  const q = [...body.items].sort((a, b) => b.magnitude - a.magnitude)[0]!;
  await boot(page, `/?proj=mercator&layers=earthquakes&c=${q.lat.toFixed(4)},${q.lng.toFixed(4)},6`);
  await page.waitForResponse((r) => r.url().includes('/api/earthquakes'), { timeout: 30_000 }).catch(() => undefined);
  const card = page.getByRole('button', { name: 'Close card' });
  const opened = await clickCentreUntil(page, async () => card.isVisible());
  expect(opened).toBe(true);
  await expectCardFrame(page, /earthquake/i);
});

test('an aircraft card opens in the HUD card frame', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop pointer test');
  const res = await page.request.get('/api/flights', { timeout: 90_000 });
  test.skip(res.status() === 503, 'adsb.lol is SOURCE OFFLINE right now');
  const f = (await res.json()) as { fields: string[]; rows: (string | number | null)[][] };
  test.skip(!f.rows?.length, 'no aircraft in the feed');
  const i = (k: string) => f.fields.indexOf(k);
  const r = [...f.rows].sort((a, b) => ((a[i('gsKt')] as number | null) ?? 0) - ((b[i('gsKt')] as number | null) ?? 0))[0]!;
  await boot(page, `/?proj=mercator&layers=flights,private,jets,military&c=${(r[i('lat')] as number).toFixed(5)},${(r[i('lng')] as number).toFixed(5)},11`);
  const status = page.getByTestId('aviation-status');
  await expect(status).toHaveAttribute('data-drawn', /^[1-9]\d*$/, { timeout: 60_000 });
  await expect(status).toHaveAttribute('data-map-ready', '1', { timeout: 60_000 });
  const card = page.getByRole('button', { name: 'Close card' });
  const opened = await clickCentreUntil(page, async () => card.isVisible());
  expect(opened).toBe(true);
  await expectCardFrame(page, /aircraft/i);
});
