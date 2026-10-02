import { expect, test, type Page } from '@playwright/test';

/**
 * layers-space end-to-end checks. Upstream-dependent steps skip (with the reason) when the server
 * reports SOURCE OFFLINE for the catalogue, so a firewalled sandbox never fakes a pass or a failure.
 */

/**
 * Open the SPACE panel the way a visitor would: the right tool strip on desktop, the MARKETS tab's
 * sheet on phones (MOBILE_SHEETS.markets = markets + space). Returns false when no launcher exists.
 */
async function openSpace(page: Page, isMobile: boolean): Promise<boolean> {
  if (isMobile) {
    const tab = page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'MARKETS' });
    if ((await tab.count()) === 0) return false;
    await tab.click();
    const sheetTab = page.getByRole('tablist', { name: 'Sheet sections' }).getByRole('tab', { name: 'SPACE' });
    if (await sheetTab.count()) await sheetTab.click();
    return true;
  }
  const tool = page.getByRole('navigation', { name: 'Tools' }).getByRole('button', { name: 'SPACE', exact: true });
  if ((await tool.count()) === 0) return false;
  await tool.click();
  return true;
}

async function bootGlobe(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });
}

test('satellites: the catalogue loads, propagates and is counted per category when live', async ({ page, request, isMobile }) => {
  test.skip(isMobile, 'the layer rail is desktop-only; mobile uses the layers sheet');
  const api = await request.get('/api/satellites');
  test.skip(api.status() === 503, 'CelesTrak and SatNOGS are both offline from this network');
  expect(api.ok()).toBe(true);
  const body = await api.json();
  expect(body.rows.length).toBeGreaterThan(0);
  expect(body.providers).toBeTruthy();

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await bootGlobe(page, '/?layers=satellites');
  await page.getByRole('button', { name: 'SPACE TRACKING' }).click();
  // Rail flyouts are disclosures (button aria-expanded + aria-controls → region "<GROUP> layers").
  const flyout = page.getByRole('region', { name: 'SPACE TRACKING layers' });
  const allRow = flyout.getByRole('button', { name: /All Satellites/ });
  await expect(allRow).toHaveAttribute('aria-pressed', 'true');
  await expect(allRow).toContainText(/\d/, { timeout: 30_000 });
  const count = Number((await allRow.innerText()).replace(/[^\d]/g, ''));
  expect(count).toBeGreaterThanOrEqual(1);
  // An element-set epoch may lie in the future (CelesTrak's CXO); the feed's observedAt never does.
  if (body.meta.observedAt) expect(Date.parse(body.meta.observedAt)).toBeLessThanOrEqual(Date.parse(body.meta.fetchedAt));
  // The rail names the catalogue in use: CelesTrak, or a FALLBACK line for SatNOGS.
  const credit = flyout.getByTestId('attribution-satellites');
  await expect(credit).toContainText(body.catalogueSource === 'satnogs-fallback' ? /FALLBACK · SatNOGS/ : /CelesTrak/);
  expect(errors).toEqual([]);
});

test('SPACE panel opens with the official NASA stream and the ISS readout', async ({ page, isMobile }) => {
  await bootGlobe(page, '/');
  test.skip(!(await openSpace(page, isMobile)), 'the HUD tool strip (design-system-hud) is not mounted in this build');
  const panel = page.getByTestId('space-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('iframe')).toHaveAttribute('src', /^https:\/\/www\.youtube-nocookie\.com\/embed\/awQzjn72bI0\?/);
  await expect(panel.getByRole('link', { name: /YouTube/ })).toHaveAttribute('rel', /noopener/);
  await expect(panel.getByText(/ISS · NORAD 25544/)).toBeVisible();
  // Round 7: wheretheiss.at computes the position from a TLE; the badge never says LIVE.
  const badge = panel.getByTestId('iss-badge');
  await expect(badge).not.toHaveText(/acquiring/i, { timeout: 20_000 });
  await expect(badge).not.toHaveText(/live/i);
  if (!/offline|stale/i.test((await badge.textContent()) ?? '')) {
    await expect(badge).toHaveText(/^Computed/i);
    await expect(panel.getByText('TLE epoch')).toBeVisible();
  }
});

test('round 8: a blocked YouTube embed never opens the player box, and the header chip reports the ISS state', async ({ page, isMobile }) => {
  // A blocking network: Chrome commits its own error page in the frame and fires `load` for it.
  // Before round 8 that `load` marked the player ready (a grey sad-page box instead of the note).
  await page.route(/^https:\/\/www\.youtube-nocookie\.com\//, (r) => r.abort('blockedbyclient'));
  await bootGlobe(page, '/');
  test.skip(!(await openSpace(page, isMobile)), 'the HUD tool strip (design-system-hud) is not mounted in this build');
  const panel = page.getByTestId('space-panel');
  await expect(panel).toBeVisible();
  const src = new URL((await panel.locator('iframe').getAttribute('src'))!);
  expect(src.searchParams.get('enablejsapi')).toBe('1');
  expect(src.searchParams.get('origin')).toBe(new URL(page.url()).origin);

  // §7: the panel header carries a state chip (the ISS readout; COMPUTED, never LIVE).
  const host = isMobile ? page.getByTestId('mobile-sheet') : page.getByRole('region', { name: 'SPACE', exact: true });
  const chip = host.locator('header .instrument-chip');
  await expect(chip).toHaveCount(1);
  await expect(chip).toHaveText(/^(CONNECTING|COMPUTED( · .+)?|STALE|OFFLINE|SOURCE OFFLINE)$/);
  await expect(chip).not.toHaveText(/^CONNECTING$/, { timeout: 20_000 });
  await expect(chip).not.toHaveText(/LIVE/);

  // The player never reports ready (nor opens its 16:9 box) while the embed is blocked; the
  // timeout then shows the "did not load" note next to the YouTube link-out.
  const player = panel.getByTestId('space-player');
  const seen = new Set<string>();
  for (let i = 0; i < 100; i++) {
    const state = (await player.getAttribute('data-state')) ?? '';
    seen.add(state);
    if (state !== 'loading') break;
    await page.waitForTimeout(250);
  }
  expect([...seen]).not.toContain('ready');
  await expect(player).toHaveAttribute('data-state', 'failed', { timeout: 20_000 });
  expect((await player.boundingBox())?.height ?? 0).toBe(0);
  await expect(panel.getByTestId('space-player-status')).toHaveText(/did not load here; open it on YouTube/);
  await expect(panel.getByRole('link', { name: /YouTube/ })).toBeVisible();
});

test('satellite card shows the PROPAGATED badge and the element epoch', async ({ page, request, isMobile }) => {
  const api = await request.get('/api/satellites');
  test.skip(api.status() === 503, 'CelesTrak and SatNOGS are both offline from this network');
  await bootGlobe(page, '/?layers=satellites');
  test.skip(!(await openSpace(page, isMobile)), 'the HUD tool strip / card host (design-system-hud) is not mounted in this build');
  const track = page.getByRole('button', { name: /Track ISS on globe/ });
  await expect(track).toBeEnabled({ timeout: 30_000 });
  await track.click();
  const card = page.getByTestId('satellite-card').first();
  await expect(card).toBeVisible();
  await expect(card.getByText('Propagated', { exact: true })).toBeVisible();
  await expect(card).toContainText(/Propagated from elements of \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/);
  await expect(card).toContainText('25544');
  // The 1 Hz worker frame fills in the altitude (never observed, always propagated).
  await expect(card.getByText(/\d{3} km$/)).toBeVisible({ timeout: 10_000 });
});
