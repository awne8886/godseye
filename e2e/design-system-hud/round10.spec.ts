import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page, type Route } from '@playwright/test';
import { MAP, waitForAdmissionDrained } from '../map-engine/helpers';

/**
 * design-system-hud, Phase 3 round 10 MAJOR 1: entity cards carry the §7 tabs OVERVIEW / TRACK /
 * SOURCES. An aircraft card's TRACK tab shows the observed flown track and altitude profile from
 * /api/aircraft, reached with the keyboard (ARIA tabs, arrow keys) and, on phones, 44 px tabs.
 *
 * Fixtures: the recorded pair in e2e/visual/fixtures made together on 2026-10-02 07:26Z from this
 * app's own routes: `/api/flights` (flights-2026-10-02T0726Z.json, the flights.json recording of
 * that minute) and `/api/aircraft?icao24=77058f` (SriLankan ALK607, 356 trace samples
 * 06:47:44–07:26:24Z). The earlier flights.json has no matching /api/aircraft recording, so it
 * could only show TRACE SOURCE OFFLINE; this pair shows a real recorded track. Every other /api
 * request is refused, basemap tiles are refused, and the clock is pinned to the fetch time.
 */
test.describe.configure({ timeout: 300_000 });

const FX = fileURLToPath(new URL('../visual/fixtures/', import.meta.url));
const fixture = (name: string) => readFileSync(path.join(FX, name), 'utf8');
const HEX = '77058f';
const AT = { lat: -31.31592, lng: 148.58476 };
const NOW = new Date('2026-10-02T07:26:38Z');
const API: readonly [RegExp, string][] = [
  [/^\/api\/flights$/, 'flights-2026-10-02T0726Z.json'],
  [/^\/api\/aircraft$/, `aircraft-${HEX}-2026-10-02T0726Z.json`],
];

async function isolate(page: Page): Promise<void> {
  await page.clock.setFixedTime(NOW);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route(/tiles\.openfreemap\.org\/planet\/|gibs\.earthdata\.nasa\.gov|arcgisonline\.com|s3\.amazonaws\.com\/elevation-tiles|airport-data\.com/, (r) => r.abort());
  await page.route(
    (u) => u.pathname.startsWith('/api/') && ['127.0.0.1', 'localhost'].includes(u.hostname),
    async (r: Route) => {
      const u = new URL(r.request().url());
      const hit = API.find(([re]) => re.test(u.pathname));
      if (hit) return r.fulfill({ status: 200, contentType: 'application/json', body: fixture(hit[1]) });
      return r.abort();
    },
  );
}

/** Open the fixture aircraft's card: the camera is centred on it (no other aircraft within 40 km). */
async function openAircraftCard(page: Page) {
  await page.goto(`/?proj=mercator&layers=flights,private,jets,military&c=${AT.lat},${AT.lng},6`);
  await expect(page.locator(MAP)).toHaveAttribute('data-map-ready', 'true', { timeout: 120_000 });
  const status = page.getByTestId('aviation-status');
  await expect(status).toHaveAttribute('data-drawn', /^[1-9]\d*$/, { timeout: 120_000 });
  await waitForAdmissionDrained(page);
  const card = page.getByTestId('aircraft-card');
  for (let attempt = 0; attempt < 6 && !(await card.isVisible()); attempt++) {
    const box = (await page.locator('canvas.maplibregl-canvas').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await card.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);
  }
  await expect(card).toBeVisible();
}

test('r10 MAJOR 1: an aircraft card has OVERVIEW / TRACK / SOURCES and TRACK shows the observed flown track', async ({ page }, info) => {
  await isolate(page);
  await openAircraftCard(page);
  const tabs = page.getByRole('tablist', { name: 'Card sections' }).getByRole('tab');
  await expect(tabs).toHaveText([/overview/i, /track/i, /sources/i]);

  // Keyboard: focus the selected tab, ArrowRight selects TRACK (roving focus follows).
  const overview = page.getByRole('tab', { name: 'overview' });
  const track = page.getByRole('tab', { name: 'track' });
  await overview.focus();
  await page.keyboard.press('ArrowRight');
  await expect(track).toHaveAttribute('aria-selected', 'true');
  await expect(track).toBeFocused();

  const panel = page.getByRole('tabpanel', { name: 'track' });
  await expect(panel.getByTestId('aircraft-track')).toBeVisible({ timeout: 30_000 });
  await expect(panel).toContainText('OBSERVED · CURRENT LEG · 356 POSITIONS');
  await expect(panel.getByTestId('ground-track-plot')).toBeVisible();
  // The recorded leg's lowest airborne baro altitude is -275 ft (pressure altitude, as reported).
  await expect(panel.getByTestId('profile-plot')).toHaveAttribute('aria-label', /^ALT: -?[\d,]+ FT to 3[\d,]+ FT, 06:47:44Z to 07:26:24Z$/);
  // The newest row is the last observed sample, with its own time (no dead-reckoned head).
  await expect(panel.getByRole('row').nth(1)).toContainText('07:26:24Z');

  // Phone layout: the tabs are 44 px touch targets; desktop keeps the compact 28 px row.
  const h = (await track.boundingBox())!.height;
  if (info.project.name === 'mobile') expect(h).toBeGreaterThanOrEqual(44);
  else expect(h).toBeGreaterThanOrEqual(28);

  // ArrowRight again reaches SOURCES.
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'sources' })).toBeFocused();
  await expect(page.getByRole('tabpanel', { name: 'sources' })).toBeVisible();
});
