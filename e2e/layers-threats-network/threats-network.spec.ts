import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * layers-threats-network: Global Incidents (GDACS) and GDELT Events render ≥ 1 entity when their
 * upstreams are live (rail counts); a REFERENCE layer card (nuclear facility) says REFERENCE; a malware
 * card says INDICATOR and names URLhaus. Runs against the live routes: when an upstream is offline
 * the route must answer SOURCE OFFLINE (503) and the render check is skipped (asserted, not faked).
 */

function hasCardHost(): boolean {
  const walk = (dir: string): boolean =>
    readdirSync(dir).some((f) => {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) return walk(p);
      return /\.tsx?$/.test(f) && !/\.test\./.test(f) && readFileSync(p, 'utf8').includes('cardFor(');
    });
  return walk(join(process.cwd(), 'src/components'));
}

async function live<T>(page: Page, path: string, provider: string): Promise<T | null> {
  const res = await page.request.get(path, { timeout: 90_000 });
  const body = await res.json();
  if (res.status() === 503) {
    expect(body.error).toBe('source_offline');
    expect(body.providers[provider].ok).toBe(false);
    return null;
  }
  if (res.status() === 403) {
    expect(body.error).toBe('capability_disabled');
    return null;
  }
  expect(res.ok()).toBe(true);
  expect(body.providers[provider].ok).toBe(true);
  expect(body.meta).toBeTruthy();
  return body as T;
}

async function openAt(page: Page, lat: number, lng: number, zoom: number, layers: string) {
  await page.goto(`/?c=${lat.toFixed(4)},${lng.toFixed(4)},${zoom}&layers=${layers}`);
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('status', { name: /loading/i })).toBeHidden({ timeout: 20_000 });
}

async function railCount(page: Page, group: string, row: RegExp): Promise<number> {
  await page.getByRole('button', { name: group }).click();
  const btn = page.getByRole('button', { name: row });
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await expect(btn).toContainText(/\d/, { timeout: 60_000 });
  return Number((await btn.innerText()).match(/([\d,]+)\s*$/)?.[1]?.replace(/,/g, ''));
}

test.describe('threats & network layers', () => {
  test('Global Incidents renders ≥ 1 GDACS incident when live', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'the layer rail flyout is desktop-only');
    const body = await live<{ items: { lat: number; lng: number }[] }>(page, '/api/gdacs', 'gdacs');
    test.skip(body === null, 'GDACS offline right now: /api/gdacs answered SOURCE OFFLINE (asserted)');
    expect(body!.items.length).toBeGreaterThan(0);
    await openAt(page, body!.items[0]!.lat, body!.items[0]!.lng, 3, 'global_incidents');
    expect(await railCount(page, 'THREATS & INTEL', /Global Incidents/)).toBeGreaterThanOrEqual(1);
  });

  test('GDELT Events renders ≥ 1 event when live', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'the layer rail flyout is desktop-only');
    const body = await live<{ items: { lat: number; lng: number }[]; window: { batches: number } }>(page, '/api/gdelt-events?limit=50', 'export');
    test.skip(body === null, 'GDELT offline right now: /api/gdelt-events answered SOURCE OFFLINE (asserted)');
    expect(body!.items.length).toBeGreaterThan(0);
    expect(body!.window.batches).toBeGreaterThanOrEqual(1);
    await openAt(page, body!.items[0]!.lat, body!.items[0]!.lng, 3, 'gdelt_events');
    expect(await railCount(page, 'THREATS & INTEL', /GDELT Events/)).toBeGreaterThanOrEqual(1);
  });

  test('a nuclear-facility card (REFERENCE layer) is badged REFERENCE', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'desktop pointer test');
    test.skip(!hasCardHost(), 'no entity-card host (cardFor) is mounted by the HUD in this build');
    const body = await live<{ items: { id: string; lat: number; lng: number }[] }>(page, '/api/infrastructure', 'curated');
    // A site with no other facility within ~30 km, so the click is unambiguous.
    const lonely = body!.items.find((s) => body!.items.every((o) => o.id === s.id || Math.hypot(o.lat - s.lat, o.lng - s.lng) > 0.3))!;
    await Promise.all([page.waitForResponse((r) => r.url().includes('/api/infrastructure') && r.ok(), { timeout: 60_000 }), openAt(page, lonely.lat, lonely.lng, 8, 'infrastructure')]);
    await page.waitForTimeout(3000);
    const vp = page.viewportSize()!;
    await page.mouse.click(vp.width / 2, vp.height / 2);
    const card = page.getByTestId('card-nuclear');
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByTestId('card-reference')).toHaveText('REFERENCE');
  });

  test('a malware card says INDICATOR and names URLhaus', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'desktop pointer test');
    test.skip(!hasCardHost(), 'no entity-card host (cardFor) is mounted by the HUD in this build');
    const body = await live<{ items: { ip: string; lat: number; lng: number }[] }>(page, '/api/malware', 'urlhaus');
    test.skip(body === null || body.items.length === 0, 'URLhaus offline/disabled right now (asserted SOURCE OFFLINE or capability_disabled)');
    // Prefer a host alone at its position (co-located ones are spread for display).
    const key = (h: { lat: number; lng: number }) => `${h.lat.toFixed(4)},${h.lng.toFixed(4)}`;
    const counts = new Map<string, number>();
    for (const h of body!.items) counts.set(key(h), (counts.get(key(h)) ?? 0) + 1);
    const host = body!.items.find((h) => counts.get(key(h)) === 1) ?? body!.items[0]!;
    await openAt(page, host.lat, host.lng, 9, 'malware');
    await page.waitForTimeout(3000);
    const vp = page.viewportSize()!;
    await page.mouse.click(vp.width / 2, vp.height / 2);
    const card = page.getByTestId('card-malware');
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByTestId('card-indicator')).toHaveText('INDICATOR');
    await expect(card).toContainText('URLhaus');
  });
});
