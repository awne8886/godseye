import { expect, test, type Page } from '@playwright/test';

/**
 * panels-alerts-markets-dossier-graph end-to-end checks: every panel opens and shows an honest
 * state — data, or SOURCE OFFLINE with what failed — never an empty list pretending to be truth.
 * Upstream-dependent assertions branch on the API's own status, so a firewalled sandbox neither
 * fakes a pass nor fails on the network.
 */

async function boot(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });
}

test('MARKETS opens with sessions + quotes, or SOURCE OFFLINE', async ({ page, request }) => {
  const api = await request.get('/api/markets');
  await boot(page, '/?panel=markets');
  const panel = page.getByTestId('markets-panel');
  await expect(panel).toBeVisible();
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
});

test('ALERTS lists stance-labelled posts and names offline sources', async ({ page, request }) => {
  const api = await request.get('/api/news');
  await boot(page, '/?panel=alerts');
  const panel = page.getByTestId('alerts-panel');
  await expect(panel).toBeVisible();
  if (api.ok()) {
    const body = await api.json();
    expect(body.meta.feed).toBe('news');
    await expect(panel.getByText(/of \d+ alerts/)).toBeVisible({ timeout: 30_000 });
    if (body.items.length) await expect(panel.getByTestId('alert-row').first()).toBeVisible();
    for (const link of await panel.locator('a[target="_blank"]').all()) {
      await expect(link).toHaveAttribute('rel', /noopener/);
      await expect(link).toHaveAttribute('href', /^https?:\/\//);
    }
  } else {
    await expect(panel.getByText(/SOURCE OFFLINE|Source offline/).first()).toBeVisible({ timeout: 30_000 });
  }
});

test('ALERTS read-out says who generated it (ANALYST when keyless)', async ({ page }) => {
  await boot(page, '/?panel=alerts');
  const panel = page.getByTestId('alerts-panel');
  await panel.getByRole('button', { name: /^Read-out$/ }).click();
  const out = panel.getByTestId('ai-readout');
  const failed = panel.getByRole('alert');
  await expect(out.or(failed)).toBeVisible({ timeout: 45_000 });
  if (await out.isVisible()) await expect(out).toContainText(/ANALYST — keyword heuristic, not AI|Claude|Gemini|Ollama/);
});

test('INTEL FEED opens with an aria-live count', async ({ page }) => {
  await boot(page, '/?panel=intel&layers=earthquakes');
  const panel = page.getByTestId('intel-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('[aria-live="polite"]')).toContainText(/events|No events yet/);
});

test('REGION DOSSIER compiles for ?dossier=lat,lng with per-layer states', async ({ page, request }) => {
  const api = await request.get('/api/region-dossier?lat=50.45&lng=30.52');
  await boot(page, '/?dossier=50.45,30.52');
  const panel = page.getByTestId('dossier-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('50.4500, 30.5200');
  if (api.ok()) {
    const body = await api.json();
    expect(body.nearby.radiusKm).toBe(150);
    await expect(panel.getByText(/Live layers within 150 km/)).toBeVisible({ timeout: 45_000 });
    // Each layer shows a count or SOURCE OFFLINE — never a bare 0 for a dead feed.
    for (const [, c] of Object.entries(body.nearby.counts as Record<string, { count: number | null }>)) if (c.count === null) await expect(panel.getByText('Source offline').first()).toBeVisible();
  } else {
    await expect(panel.getByText(/SOURCE OFFLINE/)).toBeVisible({ timeout: 45_000 });
  }
});

test('ENTITY GRAPH opens and expands an identifier (or reports the upstream offline)', async ({ page }) => {
  await boot(page, '/?panel=graph');
  const panel = page.getByTestId('graph-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByText(/Enter an identifier/)).toBeVisible();
  await panel.getByLabel('Type').selectOption('asn');
  await panel.getByLabel('Identifier').fill('AS15169');
  await panel.getByRole('button', { name: 'Graph' }).click();
  await expect(panel.getByText(/Click a node to expand it|SOURCE OFFLINE/)).toBeVisible({ timeout: 45_000 });
});

test('status-bar ticker renders server-side quotes/quakes with their own times', async ({ page, request, isMobile }) => {
  test.skip(isMobile, 'the status bar is desktop-only');
  const api = await request.get('/api/ticker');
  await boot(page, '/');
  const ticker = page.getByRole('marquee', { name: 'Latest observed events' });
  await expect(ticker).toBeVisible();
  if (api.ok()) {
    const body = await api.json();
    const first = body.crypto[0]?.symbol ?? (body.quakes[0] ? `M${body.quakes[0].magnitude.toFixed(1)}` : null);
    if (first) await expect(ticker.getByText(new RegExp(first.replace('.', '\\.'))).first()).toBeVisible({ timeout: 30_000 });
  }
});
