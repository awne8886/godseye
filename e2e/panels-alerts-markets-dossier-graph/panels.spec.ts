import { expect, test, type Page } from '@playwright/test';

/**
 * panels-alerts-markets-dossier-graph end-to-end checks: every panel opens and shows an honest
 * state — data, or SOURCE OFFLINE with what failed — never an empty list pretending to be truth.
 * Upstream-dependent assertions branch on the API's own status, so a firewalled sandbox neither
 * fakes a pass nor fails on the network.
 */

/** These panels do not need the map: wait for the HUD shell, not for the WebGL canvas. */
async function boot(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator('body')).toBeVisible();
}

const PANEL_TIMEOUT = { timeout: 45_000 };

test('MARKETS opens with sessions + quotes, or SOURCE OFFLINE', async ({ page, request }) => {
  const api = await request.get('/api/markets');
  await boot(page, '/?panel=markets');
  const panel = page.getByTestId('markets-panel');
  await expect(panel).toBeVisible(PANEL_TIMEOUT);
  if (api.ok()) {
    const body = await api.json();
    expect(body.sessions).toHaveLength(12);
    expect(body.providers).toBeTruthy();
    await expect(panel.getByRole('list', { name: 'Exchange sessions' })).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByText(/Breadth/)).toBeVisible();
  } else {
    expect(api.status()).toBe(503);
    await expect(panel.getByText(/SOURCE OFFLINE/).first()).toBeVisible({ timeout: 30_000 });
  }
  await expect(panel.getByRole('button', { name: /Market read-out/ })).toBeVisible();
  // Supply chain: a verdict only from a fresh hazard check, else the outage with its last-good time.
  const scm = await request.get('/api/scm-suppliers');
  if (scm.ok()) {
    const s = await scm.json();
    const fresh = s.providers.usgs?.ok && (s.meta.state === 'live' || s.meta.state === 'recent' || s.meta.state === 'reference');
    await expect(panel.getByTestId('scm-status')).toHaveText(fresh ? /sites with no hazard in range/i : /Hazard source (offline|stale) — last good/i, { timeout: 30_000 });
  }
});

test('ALERTS lists stance-labelled posts and names offline sources', async ({ page, request }) => {
  const api = await request.get('/api/news');
  await boot(page, '/?panel=alerts');
  const panel = page.getByTestId('alerts-panel');
  await expect(panel).toBeVisible(PANEL_TIMEOUT);
  if (api.ok()) {
    const body = await api.json();
    expect(body.meta.feed).toBe('news');
    await expect(panel.getByText(/of \d+ alerts/)).toBeVisible({ timeout: 30_000 });
    if (body.items.length) await expect(panel.getByTestId('alert-row').first()).toBeVisible();
    // One atomic read (the list may re-render on refetch while we iterate).
    const attrs = await panel.locator('a[target="_blank"]').evaluateAll((els) => els.map((e) => [e.getAttribute('href') ?? '', e.getAttribute('rel') ?? '']));
    for (const [href, rel] of attrs) {
      expect(href).toMatch(/^https?:\/\//);
      expect(rel).toMatch(/noopener/);
    }
  } else {
    await expect(panel.getByText(/SOURCE OFFLINE|Source offline/).first()).toBeVisible({ timeout: 30_000 });
  }
});

test('ALERTS chip follows a failed refetch: SOURCE OFFLINE beside the banner, never a live count (r8)', async ({ page, request }) => {
  // The retained-data case needs one real answer first; a firewalled sandbox has none to retain.
  const api = await request.get('/api/news');
  test.skip(!api.ok(), `/api/news answered ${api.status()}: no copy to retain`);
  let fail = false;
  await page.route('**/api/news', (route) => (fail ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'source_offline' }) }) : route.continue()));
  await page.clock.install();
  await boot(page, '/?panel=alerts');
  const panel = page.getByTestId('alerts-panel');
  await expect(panel.getByText(/of \d+ alerts/)).toBeVisible({ timeout: 45_000 });
  const chip = page.locator('.instrument-chip').filter({ hasText: /RESULTS|SOURCE OFFLINE/ });
  await expect(chip).toHaveText(/^\d+ RESULTS$/);
  fail = true;
  // The panel refetches every 120 s; jump past it (react-query then retries twice, 1 s and 2 s apart).
  await page.clock.fastForward('02:05');
  await page.clock.fastForward('00:05');
  await expect(panel.getByTestId('alerts-offline')).toContainText(/^SOURCE OFFLINE — no channel or wire answered; showing the last copy received/, { timeout: 30_000 });
  await expect(chip).toHaveText(/^SOURCE OFFLINE/);
  expect(await chip.evaluate((el) => (el as HTMLElement).style.color)).toBe('var(--alert-red)');
  await expect(panel.getByText(/alerts · last copy received/)).toBeVisible();
});

test('chat ANALYST names each source with its own declared stance, never a bloc as its perspective (r8)', async ({ request }) => {
  const news = await request.get('/api/news');
  test.skip(!news.ok(), `/api/news answered ${news.status()}: nothing to attribute`);
  const body = (await news.json()) as { items: { title: string; sourceName: string; lean: string; bloc: string }[] };
  // Ask about words from a regional and a western headline (the groups OSIRIS mislabelled).
  const words = ['regional', 'western']
    .map((b) => body.items.find((i) => i.bloc === b)?.title.match(/\p{L}{6,}/u)?.[0])
    .filter(Boolean)
    .join(' ');
  test.skip(!words, 'no regional or western headline in the feed right now');
  const res = await request.post('/api/ai/chat', { data: { messages: [{ role: 'user', content: `${words}?` }], provider: 'analyst' } });
  expect(res.status()).toBe(200);
  const events = (await res.text())
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { type: string; text?: string; generatedBy?: string });
  expect(events[0]).toMatchObject({ type: 'meta', generatedBy: 'analyst' });
  const text = events.map((e) => (e.type === 'delta' ? e.text : '')).join('');
  expect(text).not.toMatch(/Turkey, Middle East|Western \/ Ukrainian/);
  const leanOf = new Map(body.items.map((i) => [i.sourceName, i.lean]));
  const bullets = text.split('\n').filter((l) => l.startsWith('• '));
  expect(bullets.length).toBeGreaterThan(0);
  for (const b of bullets) {
    const m = /^• (.+?) \(([^)]+)\), /.exec(b);
    expect(m, b).not.toBeNull();
    expect(m![2], b).toBe(leanOf.get(m![1]!));
  }
});

test('ALERTS read-out says who generated it (ANALYST when keyless)', async ({ page }) => {
  await boot(page, '/?panel=alerts');
  const panel = page.getByTestId('alerts-panel');
  await panel.getByRole('button', { name: /^Read-out$/ }).click();
  await expect(panel).toBeVisible(PANEL_TIMEOUT);
  const out = panel.getByTestId('ai-readout');
  const failed = panel.getByRole('alert');
  await expect(out.or(failed)).toBeVisible({ timeout: 45_000 });
  if (await out.isVisible()) await expect(out).toContainText(/ANALYST — keyword heuristic, not AI|Claude|Gemini|Ollama/);
});

test('INTEL FEED opens with an aria-live count', async ({ page }) => {
  await boot(page, '/?panel=intel&layers=earthquakes');
  const panel = page.getByTestId('intel-panel');
  await expect(panel).toBeVisible(PANEL_TIMEOUT);
  await expect(panel.locator('[aria-live="polite"]')).toContainText(/events|No events yet/);
});

test('REGION DOSSIER compiles for ?dossier=lat,lng with per-layer states', async ({ page, request }) => {
  const api = await request.get('/api/region-dossier?lat=50.45&lng=30.52');
  await boot(page, '/?dossier=50.45,30.52');
  const panel = page.getByTestId('dossier-panel');
  await expect(panel).toBeVisible(PANEL_TIMEOUT);
  await expect(panel).toContainText('50.4500, 30.5200');
  if (api.ok()) {
    const body = await api.json();
    expect(body.nearby.radiusKm).toBe(150);
    await expect(panel.getByText(/Live layers within 150 km/)).toBeVisible({ timeout: 45_000 });
    // Each layer shows a count or the honest reason there is none (layerValue) — never a bare 0 for a dead feed.
    const counts = Object.values(body.nearby.counts as Record<string, { count: number | null }>);
    if (counts.some((c) => c.count === null)) await expect(panel.getByText(/^(Loading|Unreadable|No key|Licence off|Offline)$/).first()).toBeVisible();
  } else {
    await expect(panel.getByText(/SOURCE OFFLINE/)).toBeVisible({ timeout: 45_000 });
  }
});

test('ENTITY GRAPH opens and expands an identifier (or reports the upstream offline)', async ({ page }) => {
  await boot(page, '/?panel=graph');
  const panel = page.getByTestId('graph-panel');
  await expect(panel).toBeVisible(PANEL_TIMEOUT);
  await expect(panel.getByText(/Enter an identifier/)).toBeVisible();
  await panel.getByLabel('Type').selectOption('asn');
  await panel.getByLabel('Identifier').fill('AS15169');
  await panel.getByRole('button', { name: 'Graph', exact: true }).click();
  await expect(panel.getByText(/Click a node to expand it|SOURCE OFFLINE/)).toBeVisible({ timeout: 45_000 });
});

test('status-bar ticker renders server-side quotes/quakes with their own times', async ({ page, request, isMobile }) => {
  test.skip(isMobile, 'the status bar is desktop-only');
  const api = await request.get('/api/ticker');
  await boot(page, '/');
  const ticker = page.getByRole('marquee', { name: 'Latest observed events' });
  await expect(ticker).toBeVisible(PANEL_TIMEOUT);
  if (api.ok()) {
    const body = await api.json();
    const first = body.crypto[0]?.symbol ?? (body.quakes[0] ? `M${body.quakes[0].magnitude.toFixed(1)}` : null);
    if (first) await expect(ticker.getByText(new RegExp(first.replace('.', '\\.'))).first()).toBeVisible({ timeout: 30_000 });
  }
});
