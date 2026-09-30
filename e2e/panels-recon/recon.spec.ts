import { expect, test, type Page } from '@playwright/test';
import { gotoMap, readCamera, waitForMapIdle } from '../map-engine/helpers';

/**
 * panels-recon end-to-end checks. Browser → /api responses for SEARCH, ROUTE and RECON are
 * served from fixtures shaped like the recorded upstream answers (docs/data-sources/panels-recon.md),
 * so a firewalled sandbox neither fakes a pass nor fails on network weather; the server-side
 * refusals (SSRF, people-search) are exercised against the real routes.
 */

const NOW = '2026-09-30T20:00:00.000Z';

async function openTool(page: Page, label: string) {
  const tool = page.getByRole('button', { name: label, exact: true });
  test.skip((await tool.count()) === 0, 'the HUD tool strip (design-system-hud) is not mounted in this build');
  await tool.click();
}

test.describe('panels-recon', () => {
  test.skip(({ isMobile }) => isMobile, 'the tool strip is desktop-only; phones reach these tools via bottom-sheet tabs');

  test('SEARCH flies to a place', async ({ page }) => {
    await page.route('**/api/geosearch?**', (route) =>
      route.fulfill({
        json: {
          results: [{ name: 'Kyiv', label: 'Kyiv, Ukraine', lat: 50.4500336, lng: 30.5241361, kind: 'city', countryCode: 'UA', bbox: null, source: 'photon' }],
          attribution: 'Geocoding: Photon by komoot · Nominatim · © OpenStreetMap contributors (ODbL)',
          providers: { photon: { ok: true, count: 1, ms: 180, age_s: 0 } },
          timestamp: NOW,
        },
      }),
    );
    await gotoMap(page, { camera: { lat: 0, lng: 0, zoom: 2 } });
    await waitForMapIdle(page);
    await openTool(page, 'SEARCH');
    const panel = page.getByTestId('search-panel');
    await panel.getByLabel('Search places or coordinates').fill('Kyiv');
    const option = panel.getByRole('list', { name: 'Search results' }).getByRole('listitem').first();
    await expect(option).toContainText('Kyiv');
    await expect(panel.locator('[data-provider="photon"]')).toHaveAttribute('data-state', 'ok');
    await option.getByRole('button').click();
    await expect
      .poll(async () => {
        const c = await readCamera(page);
        return c ? Math.abs(c.lat - 50.45) < 0.5 && Math.abs(c.lng - 30.52) < 0.5 : false;
      }, { timeout: 20_000 })
      .toBe(true);
  });

  test('ROUTE plots a route with engine, steps and providers', async ({ page }) => {
    await page.route('**/api/directions?**', (route) =>
      route.fulfill({
        json: {
          engine: 'valhalla',
          mode: 'drive',
          routes: [
            {
              distanceM: 4321,
              durationS: 703,
              geometry: { type: 'LineString', coordinates: [[13.38, 52.52], [13.4, 52.51], [13.42, 52.5]] },
              steps: [
                { instruction: 'Drive east.', distanceM: 4, durationS: 4, maneuver: 'depart', startIndex: 0 },
                { instruction: 'Turn right onto Luisenstraße.', distanceM: 4000, durationS: 650, maneuver: 'right', startIndex: 1 },
                { instruction: 'You have arrived at your destination.', distanceM: 0, durationS: 0, maneuver: 'arrive', startIndex: 2 },
              ],
              hasToll: false,
              hasHighway: false,
              hasFerry: false,
            },
          ],
          elevation: null,
          ascentM: null,
          descentM: null,
          attribution: 'Routing: Valhalla (FOSSGIS) · OSRM · © OpenStreetMap contributors (ODbL)',
          providers: { valhalla: { ok: true, count: 1, ms: 745, age_s: 0 } },
          timestamp: NOW,
        },
      }),
    );
    await gotoMap(page, { camera: { lat: 0, lng: 0, zoom: 2 } });
    await waitForMapIdle(page);
    await openTool(page, 'ROUTE');
    const panel = page.getByTestId('route-panel');
    await panel.getByLabel('From').fill('52.52, 13.38');
    await panel.getByLabel('To').fill('52.50, 13.42');
    await panel.getByRole('button', { name: /Get directions/ }).click();
    const result = page.getByTestId('route-result');
    await expect(result).toBeVisible();
    await expect(result).toContainText('valhalla');
    await expect(result.getByRole('list', { name: 'Turn-by-turn steps' }).getByRole('listitem')).toHaveCount(3);
    await expect(result.locator('[data-provider="valhalla"]')).toHaveAttribute('data-state', 'ok');
    await expect
      .poll(async () => {
        const c = await readCamera(page);
        return c ? Math.abs(c.lat - 52.51) < 0.5 && c.zoom > 8 : false;
      }, { timeout: 20_000 })
      .toBe(true);
  });

  test('DRAW measures a line', async ({ page }) => {
    await gotoMap(page, { camera: { lat: 20, lng: 0, zoom: 4 } });
    await waitForMapIdle(page);
    await openTool(page, 'DRAW');
    const panel = page.getByTestId('draw-panel');
    await panel.getByRole('button', { name: /Line/ }).click();
    await expect(panel.getByRole('button', { name: /Line/ })).toHaveAttribute('aria-pressed', 'true');
    const canvas = page.locator('canvas.maplibregl-canvas');
    const box = (await canvas.boundingBox())!;
    await canvas.click({ position: { x: box.width * 0.35, y: box.height * 0.5 } });
    await canvas.click({ position: { x: box.width * 0.45, y: box.height * 0.5 } });
    await expect(panel.getByText(/2 vertices/)).toBeVisible();
    await page.keyboard.press('Enter');
    const measure = panel.getByTestId('draw-measure').first();
    await expect(measure).toHaveText(/\d[\d.,]* (NM|km|mi|ft|m)$/);
    await expect(panel.getByRole('button', { name: /Export/ })).toBeEnabled();
  });

  test('RECON looks up example.com and lists every provider honestly', async ({ page }) => {
    const ok = (ms: number) => ({ ok: true, count: 1, ms, age_s: 0 });
    const bodies: Record<string, unknown> = {
      dns: { tool: 'dns', query: 'example.com', data: { domain: 'example.com', rcode: 'NOERROR', records: { A: [{ name: 'example.com.', ttl: 300, data: '104.20.23.154' }] } }, findings: [{ level: 'low', label: 'No SPF record', detail: 'No TXT record starting with v=spf1.' }], providers: { 'dns.google': ok(290) }, timestamp: NOW },
      whois: { tool: 'whois', query: 'example.com', data: { domain: 'example.com', registrar: 'RESERVED-Internet Assigned Numbers Authority' }, findings: [], providers: { 'rdap.org': ok(520) }, timestamp: NOW },
      headers: { tool: 'headers', query: 'https://example.com/', data: { grade: 'F', via: 'proxied through this server' }, findings: [], providers: { target: ok(440) }, timestamp: NOW },
      threats: { tool: 'threats', query: 'example.com', data: { matches: [] }, findings: [], providers: { threatfox: { ok: false, count: 0, ms: 0, age_s: null, skipped: 'not-configured' }, otx: { ok: false, count: 0, ms: 0, age_s: null, skipped: 'not-configured' } }, timestamp: NOW },
      leaks: { tool: 'leaks', query: 'example.com', data: { domain: 'example.com', breaches: [] }, findings: [], providers: { xposedornot: { ok: true, count: 0, ms: 450, age_s: 0 } }, timestamp: NOW },
    };
    await page.route('**/api/osint/**', (route) => {
      const tool = new URL(route.request().url()).pathname.split('/').at(-1)!;
      if (tool === 'certs') return route.fulfill({ status: 503, json: { error: 'source_offline', detail: 'No provider answered for certs.', providers: { 'crt.sh': { ok: false, count: 0, ms: 20000, age_s: null, error: 'timeout' } }, retryAfter: 30 } });
      return route.fulfill({ json: bodies[tool] });
    });
    await gotoMap(page);
    await openTool(page, 'RECON');
    const panel = page.getByTestId('recon-panel');
    await panel.getByLabel('Target').fill('example.com');
    await panel.getByRole('button', { name: 'Run lookups' }).click();
    for (const t of ['dns', 'whois', 'certs', 'headers', 'threats', 'leaks']) await expect(panel.getByTestId(`recon-result-${t}`)).toBeVisible();
    await expect(panel.locator('[data-provider="dns.google"]')).toHaveAttribute('data-state', 'ok');
    await expect(panel.locator('[data-provider="crt.sh"]')).toHaveAttribute('data-state', 'error');
    await expect(panel.getByTestId('recon-result-certs')).toContainText('SOURCE OFFLINE');
    await expect(panel.locator('[data-provider="threatfox"]')).toHaveAttribute('data-state', 'skipped');
    await expect(panel.getByTestId('recon-result-dns')).toContainText('No SPF record');
  });

  test('RECON refuses people-search input in the browser and on the server', async ({ page, request }) => {
    const personal = await request.get('/api/osint/leaks?domain=alice%40example.com');
    expect(personal.status()).toBe(400);
    expect((await personal.json()).code).toBe('personal_identifier');
    const ssrf = await request.get(`/api/osint/headers?url=${encodeURIComponent('http://169.254.169.254/latest/meta-data/')}`);
    expect(ssrf.status()).toBe(400);
    expect((await ssrf.json()).error).toBe('blocked_target');
    await gotoMap(page);
    await openTool(page, 'RECON');
    const panel = page.getByTestId('recon-panel');
    await panel.getByLabel('Target').fill('alice@example.com');
    await panel.getByRole('button', { name: 'Run lookups' }).click();
    await expect(panel.getByRole('alert')).toContainText('not looked up');
  });

  test('REMOTE is hidden without Web Bluetooth and offered with it', async ({ page, browser }) => {
    await page.addInitScript(() => {
      // Emulate a browser without Web Bluetooth (Firefox/Safari).
      try {
        delete (Navigator.prototype as unknown as { bluetooth?: unknown }).bluetooth;
      } catch {
        /* not deletable */
      }
    });
    await gotoMap(page);
    const strip = page.getByRole('navigation', { name: 'Tools' });
    test.skip((await strip.count()) === 0, 'the HUD tool strip (design-system-hud) is not mounted in this build');
    await expect(page.getByRole('button', { name: 'SEARCH', exact: true })).toBeVisible();
    const hasBt = await page.evaluate(() => 'bluetooth' in navigator);
    test.skip(hasBt, 'this browser build does not allow removing navigator.bluetooth');
    await expect(page.getByRole('button', { name: 'REMOTE', exact: true })).toHaveCount(0);

    const ctx = await browser.newContext();
    const p2 = await ctx.newPage();
    await p2.addInitScript(() => {
      if (!('bluetooth' in navigator)) Object.defineProperty(Navigator.prototype, 'bluetooth', { value: { requestDevice: () => Promise.reject(new Error('cancelled')) }, configurable: true });
    });
    await gotoMap(p2);
    await p2.getByRole('button', { name: 'REMOTE', exact: true }).click();
    const panel = p2.getByTestId('remote-panel');
    await expect(panel.getByRole('button', { name: /Choose a device/ })).toBeVisible();
    await expect(panel).toContainText('nothing is scanned');
    await ctx.close();
  });
});
