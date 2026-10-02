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

/**
 * Watched-flight trail (TripsLayer): a second recording made together on 2026-10-02 07:26Z from this
 * app's own routes — `/api/flights` (fetched 07:26:37Z) and, one second later,
 * `/api/aircraft?icao24=77058f` (SriLankan ALK607, A333 4R-ALO, climbing out of Sydney: its current
 * leg from the adsb.lol readsb trace, 356 samples 06:47:44–07:26:24Z). The aircraft is in that
 * snapshot (seenAt 07:26:24Z at -31.31592, 148.58476), so the trail ends at its dead-reckoned head
 * exactly as in the app. Nothing in either file is edited.
 */
const TRIPS_HEX = '77058f';
const TRIPS_AT = { lat: -31.31592, lng: 148.58476 };
/** The aircraft fixture's fetch time: the head is dead-reckoned 14 s (≤ the 60 s cap) past seenAt. */
const TRIPS_NOW = new Date('2026-10-02T07:26:38Z');
const TRIPS_API: readonly [RegExp, string][] = [
  [/^\/api\/flights$/, 'flights-2026-10-02T0726Z.json'],
  [/^\/api\/aircraft$/, `aircraft-${TRIPS_HEX}-2026-10-02T0726Z.json`],
];

interface Case {
  /** Snapshot stem. */
  name: string;
  /** deck layer class that must have been admitted (data-deck-classes) before the shot. */
  deckClass: string;
  params: string;
  /** Fixture table (default API) and pinned clock (default FIXED_NOW). */
  api?: readonly [RegExp, string][];
  now?: Date;
  /** UI steps after the map is ready and before the class is awaited (e.g. watching an aircraft). */
  prepare?: (page: Page) => Promise<void>;
}

/**
 * Watch the fixture aircraft the way a user does: the camera is centred on it (isolated: no other
 * aircraft within 40 km in the snapshot), so a click on the canvas centre opens its card, then WATCH.
 * The card is dismissed so only the trail and the watch ring remain on the canvas.
 */
async function watchTripsAircraft(page: Page): Promise<void> {
  const status = page.getByTestId('aviation-status');
  await expect(status).toHaveAttribute('data-drawn', /^[1-9]\d*$/, { timeout: 90_000 });
  await expect(status).toHaveAttribute('data-trail-vertices', '0');
  // The click must not race a shader link (an admission slot is one long task on SwiftShader).
  await waitForAdmissionDrained(page);
  const box = (await page.locator('canvas.maplibregl-canvas').boundingBox())!;
  const card = page.getByTestId('aircraft-card');
  for (let attempt = 0; attempt < 4 && !(await card.isVisible()); attempt++) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await card.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);
  }
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: /^watch/i }).click();
  await expect(card.getByRole('button', { name: /unwatch/i })).toBeVisible();
  // The recorded flown track (plus the dead-reckoned head) reached the TripsLayer.
  await expect(status).toHaveAttribute('data-trail-vertices', /^(?:[2-9]|[1-9]\d+)$/, { timeout: 60_000 });
  await page.keyboard.press('Escape');
}

const CASES: readonly Case[] = [
  { name: 'scatter-earthquakes', deckClass: 'ScatterplotLayer', params: 'layers=earthquakes&c=20,140,2.2' },
  // Aircraft: SdfIconLayer (aviation's IconLayer subclass, billboard + depthCompare 'always').
  { name: 'icon-aircraft', deckClass: 'SdfIconLayer', params: 'layers=flights&c=50,5,4' },
  { name: 'h3-gps-jam', deckClass: 'H3HexagonLayer', params: 'layers=gps_jam&c=45,35,3.2' },
  // The planned route: a geodesic PathLayer (greatCircle points from the server) + airport TextLayer.
  { name: 'text-route-LHR-JFK', deckClass: 'TextLayer', params: 'layers=&route=LHR-JFK' },
  // Watched-flight trail: TripsLayer over the recorded flown track, clock at the dead-reckoned head.
  {
    name: 'trips-watched-ALK607',
    deckClass: 'TripsLayer',
    params: `layers=flights,private,jets,military&c=${TRIPS_AT.lat},${TRIPS_AT.lng},6`,
    api: TRIPS_API,
    now: TRIPS_NOW,
    prepare: watchTripsAircraft,
  },
];

async function isolate(page: Page, unmatched: string[], api: readonly [RegExp, string][], now: Date): Promise<void> {
  await page.clock.setFixedTime(now);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Basemap vector tiles and raster imagery: refused (the style JSON, sprites and glyphs still load).
  // Aircraft photos (the card's adsbdb photo URLs) are refused too: the card is hidden in the shot.
  await page.route(/tiles\.openfreemap\.org\/planet\/|gibs\.earthdata\.nasa\.gov|arcgisonline\.com|s3\.amazonaws\.com\/elevation-tiles|airport-data\.com/, (r) => r.abort());
  await page.route(
    (u) => u.pathname.startsWith('/api/') && ['127.0.0.1', 'localhost'].includes(u.hostname),
    async (r: Route) => {
      const u = new URL(r.request().url());
      const hit = api.find(([re]) => re.test(u.pathname));
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
        await isolate(page, unmatched, c.api ?? API, c.now ?? FIXED_NOW);
        await page.goto(`/?proj=${proj}&${c.params}`);
        await expect(page.locator(MAP)).toHaveAttribute('data-map-ready', 'true', { timeout: 120_000 });
        await expect(page.locator('[data-testid="map-root"]')).toHaveAttribute('data-projection', proj);
        if (c.prepare) await c.prepare(page);
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
  });
}
