import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page, type Route } from '@playwright/test';
import { MAP, waitForAdmissionDrained } from '../map-engine/helpers';

/**
 * §11 visual baselines (verification round 6): one screenshot per deck layer type, in globe AND
 * mercator, from recorded fixtures (captured from this app's own routes on 2026-10-02, see
 * docs/data-sources/map-engine.md) — never live data:
 *
 *  - every /api request is answered from a fixture or refused (no live upstream reaches the canvas);
 *  - the basemap tiles and imagery are refused (the style itself loads, so the globe sphere,
 *    background and atmosphere are drawn): only deck output and the projection differ per case;
 *  - Date is pinned to the fixtures' fetch time (aviation dead-reckons from Date.now(); freshness
 *    tiers and the solar position depend on it) and motion is reduced (route comet, pulses);
 *  - the HUD is hidden by CSS, and the shot waits for the start-up GPU queue to drain
 *    (`data-admission-pending="0"`, every deck group in the style) and for the layer class to be
 *    admitted — never a fixed delay. toHaveScreenshot then waits for two identical frames.
 *
 * Owner: map-engine. Baselines are Chromium + SwiftShader (playwright.config.ts launch flags).
 */

const FX = fileURLToPath(new URL('./fixtures/', import.meta.url));
const fixture = (name: string) => readFileSync(path.join(FX, name), 'utf8');
/** Fixtures were fetched at 2026-10-02T02:44–02:45Z; aircraft seenAt ≤ 02:44:56Z. */
const FIXED_NOW = new Date('2026-10-02T02:45:15Z');

const API: readonly [RegExp, string][] = [
  [/^\/api\/earthquakes$/, 'earthquakes.json'],
  [/^\/api\/flights$/, 'flights.json'],
  [/^\/api\/gps-interference$/, 'gps_interference.json'],
  [/^\/api\/route\/plan$/, 'route-plan-LHR-JFK.json'],
];

interface Case {
  /** Snapshot stem. */
  name: string;
  /** deck layer class that must have been admitted (data-deck-classes) before the shot. */
  deckClass: string;
  params: string;
}

const CASES: readonly Case[] = [
  { name: 'scatter-earthquakes', deckClass: 'ScatterplotLayer', params: 'layers=earthquakes&c=20,140,2.2' },
  // Aircraft: SdfIconLayer (aviation's IconLayer subclass, billboard + depthCompare 'always').
  { name: 'icon-aircraft', deckClass: 'SdfIconLayer', params: 'layers=flights&c=50,5,4' },
  { name: 'h3-gps-jam', deckClass: 'H3HexagonLayer', params: 'layers=gps_jam&c=45,35,3.2' },
  // The planned route: a geodesic PathLayer (greatCircle points from the server) + airport TextLayer.
  { name: 'text-route-LHR-JFK', deckClass: 'TextLayer', params: 'layers=&route=LHR-JFK' },
];

async function isolate(page: Page, unmatched: string[]): Promise<void> {
  await page.clock.setFixedTime(FIXED_NOW);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Basemap vector tiles and raster imagery: refused (the style JSON, sprites and glyphs still load).
  await page.route(/tiles\.openfreemap\.org\/planet\/|gibs\.earthdata\.nasa\.gov|arcgisonline\.com|s3\.amazonaws\.com\/elevation-tiles/, (r) => r.abort());
  await page.route(
    (u) => u.pathname.startsWith('/api/') && ['127.0.0.1', 'localhost'].includes(u.hostname),
    async (r: Route) => {
      const u = new URL(r.request().url());
      const hit = API.find(([re]) => re.test(u.pathname));
      if (hit) return r.fulfill({ status: 200, contentType: 'application/json', body: fixture(hit[1]) });
      unmatched.push(u.pathname);
      return r.abort();
    },
  );
}

for (const proj of ['globe', 'mercator'] as const) {
  test.describe(`deck baselines · ${proj}`, () => {
    test.describe.configure({ timeout: 240_000 });
    test.beforeEach(() => {
      test.skip(test.info().project.name !== 'desktop', 'baselines are recorded at the desktop viewport only');
    });

    for (const c of CASES) {
      test(`${c.deckClass} · ${c.name}`, async ({ page }) => {
        const unmatched: string[] = [];
        await isolate(page, unmatched);
        await page.goto(`/?proj=${proj}&${c.params}`);
        await expect(page.locator(MAP)).toHaveAttribute('data-map-ready', 'true', { timeout: 120_000 });
        await expect(page.locator('[data-testid="map-root"]')).toHaveAttribute('data-projection', proj);
        await expect(page.locator(MAP)).toHaveAttribute('data-deck-classes', new RegExp(`(^|,)${c.deckClass}(,|$)`), { timeout: 150_000 });
        await waitForAdmissionDrained(page);
        await page.addStyleTag({ content: 'body * { visibility: hidden !important } .maplibregl-canvas { visibility: visible !important }' });
        await expect(page).toHaveScreenshot(`${c.name}-${proj}.png`, { timeout: 60_000 });
        test.info().annotations.push({ type: 'refused /api', description: [...new Set(unmatched)].join(' ') || 'none' });
      });
    }

    test.fixme(`ArcLayer (greatCircle) · attack-origin arcs · ${proj}`, () => {
      // The only ArcLayer in src is the Cloudflare Radar attack-origin layer (NetworkLayer
      // `tn-origin-arcs`), drawn only for rows whose upstream names a target. Radar answers 401
      // without CLOUDFLARE_API_TOKEN (src/features/network/server/__fixtures__/cloudflare-radar-401…),
      // so there is no recorded response with targets to feed it, and §0 forbids inventing one.
      // Record /api/cloudflare-radar with a token, add it to API above, and enable this case.
    });

    test.fixme(`TripsLayer · watched-flight trail · ${proj}`, () => {
      // No TripsLayer exists in this base: aviation's watched trails are still a PathLayer
      // (src/features/aviation/client/layers.ts). Enable once the TripsLayer conversion lands, fed by
      // a recorded /api/flight trail fixture.
    });
  });
}
