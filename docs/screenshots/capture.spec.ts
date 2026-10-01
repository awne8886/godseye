import { expect, test, type Locator, type Page } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Visual-QA capture (§7). Re-run with docs/screenshots/playwright.config.ts against a running build;
 * each shot lands in docs/screenshots/<area>/<name>-<desktop|mobile>.png. Clocks, the ticker and
 * relative ages are masked so re-captures diff cleanly. Shots never assert on live data: when an
 * upstream is offline the honest offline state is what gets captured.
 */

/** PNGs go to CAPTURE_PNG_DIR (default: next to this file); convert-webp.py writes the committed WebP set. */
const OUT = process.env.CAPTURE_PNG_DIR ?? dirname(fileURLToPath(import.meta.url));
const MAP = '[data-testid="map-root"] .maplibregl-map';

type Viewport = 'desktop' | 'mobile';

interface Shot {
  area: string;
  name: string;
  /** Query string (without `?`) or a path starting with `/`. */
  url: string;
  /** Extra settle after the map is ready (ms). */
  settle?: number;
  /** Runs after boot, before the screenshot. */
  act?: (page: Page, vp: Viewport) => Promise<void>;
  /** Only capture the page (non-map routes). */
  page?: boolean;
  /** Screenshot before the splash lifts. */
  splash?: boolean;
  /** Skip the 390×844 capture (keeps a full round under the time budget). */
  desktopOnly?: boolean;
  /** Only the 390×844 capture (mobile sheet checks). */
  mobileOnly?: boolean;
}

function masks(page: Page): Locator[] {
  return [
    page.locator('.hud-ticker'),
    page.getByText(/^UTC \d\d:\d\d · LOCAL/),
    page.getByText(/^ZULU /),
  ];
}

const DEBUG = process.env.CAPTURE_DEBUG === '1';
function mark(t0: number, what: string): void {
  if (DEBUG) console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s ${what}`);
}

async function boot(page: Page, url: string): Promise<void> {
  const t0 = Date.now();
  await page.goto(url.startsWith('/') ? url : `/?${url}`);
  mark(t0, 'goto');
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 90_000 });
  mark(t0, 'canvas');
  await expect(page.getByRole('status', { name: /loading/i })).toBeHidden({ timeout: 30_000 });
  mark(t0, 'splash lifted');
  // Style parsed; `data-map-ready` (first idle) rarely fires under SwiftShader with live layers
  // animating, so shots settle on a fixed delay instead. Tolerate slow proxies.
  await expect(page.locator(MAP)).toHaveAttribute('data-style-ready', 'true', { timeout: 30_000 }).catch(() => {
    test.info().annotations.push({ type: 'env', description: 'style not ready within 30 s (tile proxy?)' });
    mark(t0, 'style-ready TIMEOUT');
  });
  mark(t0, 'style ready');
}

/** Centre the camera on a point, then click the centre to open that entity's card. */
async function cardAt(page: Page, vp: Viewport, qs: (lat: number, lng: number) => string, ll: { lat: number; lng: number } | null): Promise<void> {
  if (!ll) return;
  await boot(page, qs(ll.lat, ll.lng));
  // Wait until the layer has drawn entities (telemetry ENTITIES > 0), then for tiles to settle.
  await page
    .waitForFunction(() => /(^|\D)[1-9][\d,]* ENTITIES/.test(document.querySelector('[aria-label="Telemetry"]')?.textContent ?? ''), undefined, { timeout: 60_000 })
    .catch(() => test.info().annotations.push({ type: 'env', description: 'no entities drawn within 60 s' }));
  await page.waitForTimeout(5000);
  const v = page.viewportSize()!;
  await page.mouse.click(v.width / 2, v.height / 2);
  const card = page.locator('[data-testid$="-card"]').first();
  const opened = await card.waitFor({ timeout: 10_000 }).then(() => true).catch(() => false);
  if (!opened) test.info().annotations.push({ type: 'miss', description: `no card opened (${vp})` });
  await page.waitForTimeout(1500);
}

async function api<T>(page: Page, path: string): Promise<T | null> {
  const r = await page.request.get(path, { timeout: 30_000 }).catch(() => null);
  if (!r || !r.ok()) return null;
  return (await r.json()) as T;
}

type Rows = { fields: string[]; rows: unknown[][] };
function rowPoint(d: Rows | null, pick: (rows: unknown[][], f: (n: string) => number) => unknown[] | undefined): { lat: number; lng: number } | null {
  if (!d?.rows?.length) return null;
  const f = (n: string) => d.fields.indexOf(n);
  const r = pick(d.rows, f);
  return r ? { lat: r[f('lat')] as number, lng: r[f('lng')] as number } : null;
}

/** Panels reachable from the command palette (one boot per viewport, palette → Enter). */
const PALETTE_PANELS: Array<[label: string, file: string, role: 'region' | 'dialog']> = [
  ['LAYERS', 'layers', 'region'], ['REGION PRESETS', 'presets', 'region'], ['SETTINGS', 'settings', 'region'],
  ['STYLE STUDIO', 'style-studio', 'region'], ['SHARE', 'share', 'region'], ['SHORTCUTS', 'shortcuts', 'dialog'],
  ['SOURCES & LICENCES', 'sources-licences', 'region'], ['RECON', 'recon', 'region'], ['SPACE', 'space', 'region'],
  ['MARKETS', 'markets', 'region'], ['ALERTS', 'alerts', 'region'], ['DRAW', 'draw', 'region'], ['ROUTE', 'route', 'region'],
  ['PATHS', 'paths', 'region'], ['SEARCH', 'search', 'region'], ['ARCGIS', 'arcgis', 'region'], ['INTEL FEED', 'intel', 'region'],
];
/** Context panels (opened from cards/map, not listed in the palette): deep-linked with ?panel=. */
const CONTEXT_PANELS: Array<[id: string, file: string]> = [
  ['graph', 'entity-graph'], ['flight-watch', 'flight-watch'], ['camera', 'camera-viewer'], ['live-news', 'live-news'],
];

/** Wait (≤ 60 s) until the camera recorded at the last moveend is near a target (route fly-to). */
async function waitCamera(page: Page, lat: number, lng: number, tol = 8): Promise<void> {
  const near = await page
    .waitForFunction(
      ([sel, la, ln, t]) => {
        const raw = document.querySelector(sel as string)?.getAttribute('data-camera');
        if (!raw) return false;
        const [cLat, cLng] = raw.split(',').map(Number) as [number, number];
        const dLng = Math.abs((((cLng - (ln as number)) % 360) + 540) % 360 - 180);
        return Math.abs(cLat - (la as number)) < (t as number) && dLng < (t as number);
      },
      [MAP, lat, lng, tol] as const,
      { timeout: 60_000 },
    )
    .then(() => true)
    .catch(() => false);
  if (!near) test.info().annotations.push({ type: 'camera', description: `camera did not reach ${lat},${lng} within 60 s` });
  await page.waitForTimeout(4000);
}

/** Flight Paths routes (§8) with their great-circle midpoints (where the planner frames the camera). */
const ROUTES: Array<[id: string, lat: number, lng: number]> = [
  ['LHR-JFK', 52.2, -41.3],
  ['SYD-SCL', -61.7, -139.3],
  ['SVO-LAX', 74.2, -82.7],
];

/** Switch the PATHS panel mode tab (ROUTE / LIVE / FLIGHT) and let the mode's data arrive. */
async function pathsTab(page: Page, name: 'ROUTE' | 'LIVE' | 'FLIGHT'): Promise<void> {
  const tab = page.getByRole('tablist', { name: 'Flight paths mode' }).getByRole('tab', { name, exact: true });
  const ok = await tab.click({ timeout: 10_000 }).then(() => true).catch(() => false);
  if (!ok) test.info().annotations.push({ type: 'miss', description: `PATHS ${name} tab not reachable` });
  await page.waitForTimeout(8000);
}

const PRESETS = ['HORUS', 'PHANTOM', 'TERMINAL', 'CRIMSON', 'ARCTIC', 'BLACKOUT', 'EMBER', 'MONO', 'NVG'];

const LAYER_GROUPS: Array<[string, string, string]> = [
  ['aviation', 'flights,private,jets,military,gps_jam', '50,10,4'],
  ['threats', 'infrastructure,global_incidents,alert_pins,gdelt_events,conflict_zones,frontlines,country_risk', '38,38,3'],
  ['hazards', 'earthquakes,fires,weather,air_quality,weather_radar', '10,-80,2'],
  ['network', 'malware,cyber_attacks,threatfox', '30,60,1.6'],
  ['surveillance', 'cctv,live_news', '37.5,-120,5'],
  ['maritime', 'maritime,sdk_sea', '24,56,4'],
  ['space', 'satellites,sat_comms,sat_military,sat_navigation,sat_earth,sat_science', '20,0,1.2'],
  ['netintel', 'cf_outages,cf_attacks', '20,10,1.6'],
  ['display', 'day_night,gibs_truecolor,sentinel', '20,0,1.4'],
  ['display-3d', 'terrain_3d,terrain_elevation', '40.7069,-74.0113,15.5,60,-20'],
];

const SHOTS: Shot[] = [
  { area: 'splash', name: 'splash', url: '', splash: true },
  { area: 'landing', name: 'globe', url: '', settle: 3000 },
  { area: 'landing', name: 'flat-2d', url: 'proj=mercator', settle: 3000 },
  { area: 'landing', name: 'night', url: 'c=48,12,3', settle: 3000, desktopOnly: true },
  {
    area: 'landing', name: 'satellite', url: 'c=48,12,3', settle: 5000,
    act: async (p) => { await p.getByRole('group', { name: 'Basemap' }).getByRole('radio', { name: /SAT/ }).or(p.getByRole('group', { name: 'Basemap' }).getByRole('button', { name: /SAT/ })).first().click(); await p.waitForTimeout(8000); },
  },
  { area: 'panels', name: 'dossier', url: 'dossier=50.45,30.52', settle: 8000 },
  ...CONTEXT_PANELS.map(([id, name]): Shot => ({ area: 'panels', name, url: `panel=${id}`, settle: 2500, desktopOnly: id !== 'camera' })),
  ...LAYER_GROUPS.map(([g, layers, c]): Shot => ({ area: 'layers', name: g, url: `layers=${layers}&c=${c}`, settle: 9000, desktopOnly: !['aviation', 'threats', 'hazards'].includes(g) })),
  ...ROUTES.flatMap(([id, lat, lng]): Shot[] => [
    { area: 'flight-paths', name: `${id.toLowerCase()}-route-globe`, url: `route=${id}`, settle: 3000, act: (p) => waitCamera(p, lat, lng) },
    { area: 'flight-paths', name: `${id.toLowerCase()}-route-mercator`, url: `route=${id}&proj=mercator`, settle: 3000, desktopOnly: true, act: (p) => waitCamera(p, lat, lng) },
    { area: 'flight-paths', name: `${id.toLowerCase()}-live-globe`, url: `route=${id}`, settle: 3000, act: async (p) => { await waitCamera(p, lat, lng); await pathsTab(p, 'LIVE'); } },
  ]),
  { area: 'panels', name: 'recon', url: 'panel=recon', settle: 5000, desktopOnly: true },
  { area: 'panels', name: 'paths-sheet', url: 'panel=paths', settle: 10_000, mobileOnly: true },
  { area: 'panels', name: 'markets-sheet', url: 'panel=markets', settle: 10_000, mobileOnly: true },
  { area: 'panels', name: 'layers-sheet', url: 'panel=layers', settle: 6000, mobileOnly: true },
  { area: 'pages', name: 'docs', url: '/docs', page: true },
  { area: 'pages', name: 'privacy', url: '/privacy', page: true },
  { area: 'pages', name: 'cameras-notice', url: '/cameras-notice', page: true },
];

/** CAPTURE_SKIP_EXISTING=1 resumes an interrupted round without re-shooting what is already on disk. */
const SKIP_EXISTING = process.env.CAPTURE_SKIP_EXISTING === '1';
const have = (file: string) => SKIP_EXISTING && existsSync(file);

async function shoot(page: Page, file: string, full = false): Promise<void> {
  mkdirSync(dirname(file), { recursive: true });
  const t0 = Date.now();
  await page.screenshot({ path: file, fullPage: full, mask: masks(page), maskColor: '#04040A', animations: 'disabled', timeout: 60_000 });
  mark(t0, `screenshot ${file.split('/').slice(-2).join('/')}`);
}

for (const s of SHOTS) {
  test(`${s.area}/${s.name}`, async ({ page }, info) => {
    const vp = info.project.name as Viewport;
    test.skip(vp === 'mobile' && !!s.desktopOnly, 'desktop-only shot');
    test.skip(vp === 'desktop' && !!s.mobileOnly, 'mobile-only shot');
    const file = join(OUT, s.area, `${s.name}-${vp}.png`);
    test.skip(have(file), 'already captured');
    if (s.page) {
      await page.goto(s.url);
      await page.waitForLoadState('load');
      await page.waitForTimeout(1500);
      await shoot(page, file, false);
      return;
    }
    if (s.splash) {
      await page.goto('/');
      await page.waitForTimeout(900);
      await shoot(page, file);
      return;
    }
    await boot(page, s.url);
    await page.waitForTimeout(s.settle ?? 2000);
    if (s.act) await s.act(page, vp);
    await shoot(page, file);
  });
}

/* ───────────── batched shots: one boot, many states ───────────── */

test('panels/palette-batch', async ({ page }, info) => {
  const vp = info.project.name as Viewport;
  const todo = PALETTE_PANELS.filter(([, f]) => !have(join(OUT, 'panels', `${f}-${vp}.png`)));
  test.skip(!todo.length, 'already captured');
  test.setTimeout(420_000);
  await boot(page, 'c=30,10,1.8');
  await page.waitForTimeout(3000);
  for (const [label, file, role] of todo) {
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await palette.waitFor({ timeout: 5000 });
    await page.keyboard.type(label);
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    const target = role === 'dialog' ? page.getByRole('dialog', { name: /shortcuts/i }) : page.getByRole('region', { name: new RegExp(`^(FLIGHT )?${label}$`) });
    const ok = await target.first().waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
    if (!ok) test.info().annotations.push({ type: 'miss', description: `${label} did not open from the palette` });
    await page.waitForTimeout(1800);
    await shoot(page, join(OUT, 'panels', `${ok ? file : `${file}-MISSING`}-${vp}.png`));
  }
  // The palette itself, with a query typed.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('LHR JFK');
  await page.waitForTimeout(1200);
  await shoot(page, join(OUT, 'panels', `palette-${vp}.png`));
});

test('presets/batch', async ({ page }, info) => {
  const vp = info.project.name as Viewport;
  test.skip(have(join(OUT, 'presets', `ghost-${vp}.png`)), 'already captured');
  test.setTimeout(300_000);
  await boot(page, 'layers=flights,earthquakes,conflict_zones&c=40,20,2.2&panel=style-studio');
  await page.waitForTimeout(6000);
  const studio = page.getByRole('region', { name: 'STYLE STUDIO' }).or(page.getByRole('dialog', { name: /STYLE STUDIO/i })).first();
  for (const t of PRESETS) {
    const btn = studio.getByRole('button', { name: t, exact: true }).or(studio.getByRole('radio', { name: t, exact: true })).first();
    await btn.click({ timeout: 5000 }).catch(() => test.info().annotations.push({ type: 'miss', description: `preset ${t} button` }));
    // Under a slow renderer the click can land seconds later: wait for <html data-theme> to match.
    await page.waitForFunction((id) => (document.documentElement.getAttribute('data-theme') ?? 'HORUS') === id, t, { timeout: 20_000 }).catch(() => test.info().annotations.push({ type: 'miss', description: `preset ${t} not applied` }));
    await page.waitForTimeout(1500);
    await shoot(page, join(OUT, 'presets', `${t.toLowerCase()}-${vp}.png`));
  }
  await studio.getByRole('button', { name: 'HORUS', exact: true }).or(studio.getByRole('radio', { name: 'HORUS', exact: true })).first().click().catch(() => undefined);
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-theme'), undefined, { timeout: 20_000 }).catch(() => undefined);
  await studio.getByRole('button', { name: /GHOST PROTOCOL/i }).first().click({ timeout: 5000 }).catch(() => test.info().annotations.push({ type: 'miss', description: 'ghost toggle' }));
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-ghost'), undefined, { timeout: 20_000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  await shoot(page, join(OUT, 'presets', `ghost-${vp}.png`));
});

test('sensors/batch', async ({ page }, info) => {
  const vp = info.project.name as Viewport;
  test.skip(vp === 'mobile', 'desktop-only');
  test.skip(have(join(OUT, 'sensors', `noir-${vp}.png`)), 'already captured');
  test.setTimeout(240_000);
  await boot(page, 'layers=flights,earthquakes&c=48,12,4');
  await page.waitForTimeout(6000);
  for (const [k, name] of [['1', 'crt'], ['2', 'nvg'], ['3', 'flir'], ['4', 'noir']] as const) {
    await page.keyboard.press(k);
    await page.waitForFunction((m) => document.documentElement.getAttribute('data-sensor') === m, name, { timeout: 20_000 }).catch(() => test.info().annotations.push({ type: 'miss', description: `sensor ${name} not applied` }));
    await page.waitForTimeout(1500);
    await shoot(page, join(OUT, 'sensors', `${name}-${vp}.png`));
  }
});

/* ───────────── entity cards: centre on a real, current entity and click it ───────────── */

test('cards/earthquake', async ({ page }, info) => {
  test.skip(have(join(OUT, 'cards', `earthquake-${info.project.name}.png`)), 'already captured');
  const d = await api<{ items: Array<{ lat: number; lng: number; magnitude: number }> }>(page, '/api/earthquakes');
  const q = d?.items?.length ? [...d.items].sort((a, b) => b.magnitude - a.magnitude)[0]! : null;
  await cardAt(page, info.project.name as Viewport, (a, b) => `layers=earthquakes&c=${a},${b},6`, q);
  await shoot(page, join(OUT, 'cards', `earthquake-${info.project.name}.png`));
});

test('cards/fire', async ({ page }, info) => {
  test.skip(have(join(OUT, 'cards', `fire-${info.project.name}.png`)), 'already captured');
  const d = await api<Rows>(page, '/api/fires');
  const pt = rowPoint(d, (rows, f) => [...rows].sort((a, b) => (b[f('frpMw')] as number) - (a[f('frpMw')] as number))[0]);
  await cardAt(page, info.project.name as Viewport, (a, b) => `layers=fires&c=${a},${b},9`, pt);
  await shoot(page, join(OUT, 'cards', `fire-${info.project.name}.png`));
});

test('cards/camera', async ({ page }, info) => {
  test.skip(have(join(OUT, 'cards', `camera-${info.project.name}.png`)), 'already captured');
  const d = await api<Rows>(page, '/api/cctv');
  const pt = rowPoint(d, (rows) => rows[0]);
  await cardAt(page, info.project.name as Viewport, (a, b) => `layers=cctv&c=${a},${b},13`, pt);
  await shoot(page, join(OUT, 'cards', `camera-${info.project.name}.png`));
  const open = page.getByTestId('camera-card').getByRole('button').filter({ hasText: /view|watch|open|live/i }).first();
  if (await open.isVisible().catch(() => false)) {
    await open.click();
    await page.waitForTimeout(3000);
    await shoot(page, join(OUT, 'panels', `camera-viewer-from-card-${info.project.name}.png`));
  }
});

test('cards/aircraft', async ({ page }, info) => {
  test.skip(have(join(OUT, 'cards', `aircraft-${info.project.name}.png`)), 'already captured');
  const vp = info.project.name as Viewport;
  const d = await api<Rows>(page, '/api/flights');
  // A slow, airborne aircraft moves least between fetch and click.
  const pt = rowPoint(d, (rows, f) => rows.find((r) => r[f('onGround')] === 0 && typeof r[f('gsKt')] === 'number' && (r[f('gsKt')] as number) < 150 && (r[f('gsKt')] as number) > 60));
  await cardAt(page, vp, (a, b) => `layers=flights,private,jets,military&c=${a},${b},7`, pt);
  await shoot(page, join(OUT, 'cards', `aircraft-${vp}.png`));
  const watch = page.getByTestId('aircraft-card').getByRole('button').filter({ hasText: /watch/i }).first();
  if (await watch.isVisible().catch(() => false)) {
    await watch.click();
    await page.waitForTimeout(2500);
    await shoot(page, join(OUT, 'panels', `flight-watch-from-card-${vp}.png`));
  }
});

test('cards/satellite', async ({ page }, info) => {
  test.skip(have(join(OUT, 'cards', `satellite-${info.project.name}.png`)), 'already captured');
  const iss = await api<{ lat?: number; lng?: number; position?: { lat: number; lng: number } }>(page, '/api/iss');
  const ll = iss?.position ?? (iss && typeof iss.lat === 'number' ? { lat: iss.lat, lng: iss.lng! } : null);
  await cardAt(page, info.project.name as Viewport, (a, b) => `layers=satellites&c=${a},${b},4`, ll);
  await shoot(page, join(OUT, 'cards', `satellite-${info.project.name}.png`));
});

test('cards/conflict-zone', async ({ page }, info) => {
  test.skip(have(join(OUT, 'cards', `conflict-zone-${info.project.name}.png`)), 'already captured');
  await cardAt(page, info.project.name as Viewport, (a, b) => `layers=conflict_zones&c=${a},${b},5`, { lat: 48.558, lng: 31.377 });
  await shoot(page, join(OUT, 'cards', `conflict-zone-${info.project.name}.png`));
});

test('cards/malware', async ({ page }, info) => {
  test.skip(have(join(OUT, 'cards', `malware-${info.project.name}.png`)), 'already captured');
  const d = await api<{ items: Array<{ lat: number; lng: number; geoPrecision?: string }> }>(page, '/api/malware');
  const m = d?.items?.find((i) => i.geoPrecision === 'city') ?? d?.items?.[0] ?? null;
  await cardAt(page, info.project.name as Viewport, (a, b) => `layers=malware&c=${a},${b},8`, m);
  await shoot(page, join(OUT, 'cards', `malware-${info.project.name}.png`));
});

test('flight-paths/flight-tracking', async ({ page }, info) => {
  test.skip(have(join(OUT, 'flight-paths', `flight-tracking-${info.project.name}.png`)), 'already captured');
  const d = await api<Rows>(page, '/api/flights');
  const f = (n: string) => d?.fields.indexOf(n) ?? -1;
  const r = d?.rows.find((x) => typeof x[f('callsign')] === 'string' && /^[A-Z]{3}\d{1,4}$/.test((x[f('callsign')] as string).trim()) && x[f('onGround')] === 0);
  const cs = r ? (r[f('callsign')] as string).trim() : 'BA117';
  await boot(page, `flight=${cs}`);
  await page.waitForTimeout(9000);
  await shoot(page, join(OUT, 'flight-paths', `flight-tracking-${info.project.name}.png`));
});

/* ───────────── environment diagnostic: are basemap tiles reaching the browser? ───────────── */

test('diag/tiles', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile' || process.env.CAPTURE_DIAG !== '1', 'diagnostic only');
  const stats: Record<string, { ok: number; fail: number; ms: number[] }> = {};
  const started = new Map<string, number>();
  const hostOf = (u: string) => new URL(u).host;
  page.on('request', (r) => started.set(r.url(), Date.now()));
  page.on('requestfinished', async (r) => {
    const h = hostOf(r.url());
    const s = (stats[h] ??= { ok: 0, fail: 0, ms: [] });
    const res = await r.response().catch(() => null);
    if (res && res.status() < 400) s.ok++;
    else s.fail++;
    s.ms.push(Date.now() - (started.get(r.url()) ?? Date.now()));
  });
  page.on('requestfailed', (r) => {
    const s = (stats[hostOf(r.url())] ??= { ok: 0, fail: 0, ms: [] });
    s.fail++;
  });
  await boot(page, 'c=48,12,4&proj=mercator');
  await page.waitForTimeout(20_000);
  const summary = Object.fromEntries(
    Object.entries(stats).map(([h, s]) => [h, { ok: s.ok, fail: s.fail, p50ms: [...s.ms].sort((a, b) => a - b)[Math.floor(s.ms.length / 2)] ?? null }]),
  );
  console.log(JSON.stringify(summary, null, 1));
  await shoot(page, join(OUT, 'audit', 'diag-tiles-desktop.png'));
});

/* ───────────── DOM audit: overlaps, tiny text, tracking, touch targets (JSON next to the shots) ───────────── */

test('audit/dom', async ({ page }, info) => {
  const vp = info.project.name as Viewport;
  test.skip(have(join(OUT, 'audit', `dom-${vp}.json`)), 'already captured');
  await boot(page, 'layers=flights,earthquakes,day_night&c=30,0,2');
  await page.waitForTimeout(6000);
  const report = await page.evaluate((isMobile) => {
    const vis = (el: Element) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
    };
    const box = (el: Element | null) => {
      if (!el || !vis(el)) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), z: getComputedStyle(el).zIndex };
    };
    const q = (s: string) => document.querySelector(s);
    const byText = (re: RegExp) => [...document.querySelectorAll('li,span,div,p')].find((e) => re.test(e.textContent ?? '') && e.children.length === 0) ?? null;
    const named: Record<string, ReturnType<typeof box>> = {
      attribution: box(q('.maplibregl-ctrl-attrib')),
      imageryChips: box(q('.godseye-imagery-chips')),
      statusBar: box(q('footer')),
      mobileNav: box(q('nav[aria-label="Main"]')),
      viewControls: box(q('[role="group"][aria-label="Projection"]')?.parentElement ?? null),
      scaleBar: box(q('[data-testid="scale-bar"]')),
      readout: box(q('[data-testid="cursor-readout"]')),
      telemetry: box(q('[aria-label="Telemetry"]')),
      tools: box(q('[aria-label="Tools"]')),
      rail: box(q('nav[aria-label="Map layers"]')),
      hint: box(byText(/DRAG TO PAN/)),
    };
    const keys = Object.keys(named).filter((k) => named[k]);
    const overlaps: string[] = [];
    for (let i = 0; i < keys.length; i++)
      for (let j = i + 1; j < keys.length; j++) {
        const a = named[keys[i]!]!;
        const b = named[keys[j]!]!;
        const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ix > 2 && iy > 2) overlaps.push(`${keys[i]} x ${keys[j]} (${ix}x${iy}px)`);
      }
    const tiny: string[] = [];
    const tracking: string[] = [];
    for (const el of document.querySelectorAll('body *')) {
      if (!vis(el) || el.closest('.maplibregl-canvas-container')) continue;
      const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent!.trim()).map((n) => n.textContent!.trim()).join(' ');
      if (!own) continue;
      const cs = getComputedStyle(el);
      const fs = parseFloat(cs.fontSize);
      const ls = cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing) / fs;
      const mono = /JetBrains/i.test(cs.fontFamily);
      if (fs < 10 && !el.closest('nav[aria-label="Main"]')) tiny.push(`${fs}px "${own.slice(0, 40)}"`);
      if (mono && cs.textTransform === 'uppercase' && fs <= 10 && Math.abs(ls - 0.16) > 0.02 && ls < 0.2) tracking.push(`${fs}px ls=${ls.toFixed(2)}em "${own.slice(0, 30)}"`);
      if (mono && cs.textTransform === 'uppercase' && fs >= 11 && Math.abs(ls - 0.08) > 0.02 && ls < 0.2) tracking.push(`${fs}px ls=${ls.toFixed(2)}em "${own.slice(0, 30)}"`);
    }
    const smallTargets: string[] = [];
    if (isMobile)
      for (const el of document.querySelectorAll('button, a, [role="button"], [role="radio"], input')) {
        if (!vis(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 44 || r.height < 44) smallTargets.push(`${Math.round(r.width)}x${Math.round(r.height)} ${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}`);
      }
    const attrib = document.querySelector('.maplibregl-ctrl-attrib');
    // What actually paints on top of the attribution and the imagery chips (overlays, status bar, nav).
    const topAt = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + Math.min(20, r.width / 2), r.y + r.height / 2);
      return hit ? `${hit.tagName.toLowerCase()}.${String(hit.className).split(' ').slice(0, 3).join('.')}` : null;
    };
    const corner = document.querySelector('.maplibregl-ctrl-bottom-right');
    const ccs = corner ? getComputedStyle(corner) : null;
    const stacking = {
      bottomRightCorner: ccs ? { bottom: ccs.bottom, zIndex: ccs.zIndex } : null,
      topOfAttribution: topAt(attrib),
      topOfImageryChip: topAt(document.querySelector('[data-testid^="imagery-chip-"]')),
      // Overlays are pointer-events:none, so elementFromPoint skips them: report their stacking instead.
      overlays: [...document.querySelectorAll('.vignette, .fx-vignette, .crt-scanlines, .fx-scanlines')].map((o) => {
        const chain: string[] = [];
        for (let e: Element | null = o; e && e !== document.body; e = e.parentElement) {
          const cs = getComputedStyle(e);
          if (cs.zIndex !== 'auto') chain.push(`${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]} z=${cs.zIndex} pos=${cs.position}`);
        }
        return { cls: o.className, opacity: getComputedStyle(o).opacity, chain };
      }),
      cornerChain: (() => {
        const chain: string[] = [];
        for (let e: Element | null = corner; e && e !== document.body; e = e.parentElement) {
          const cs = getComputedStyle(e);
          if (cs.zIndex !== 'auto') chain.push(`${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]} z=${cs.zIndex}`);
        }
        return chain;
      })(),
      chipColor: (() => {
        const c = document.querySelector('[data-testid^="imagery-chip-"]');
        return c ? { color: getComputedStyle(c).color, bg: getComputedStyle(c).backgroundColor, fontSize: getComputedStyle(c).fontSize } : null;
      })(),
    };
    return {
      stacking,
      named,
      overlaps,
      tiny: [...new Set(tiny)],
      tracking: [...new Set(tracking)],
      smallTargets: [...new Set(smallTargets)],
      attributionText: attrib?.textContent ?? null,
      attributionClass: attrib?.className ?? null,
    };
  }, vp === 'mobile');
  mkdirSync(join(OUT, 'audit'), { recursive: true });
  writeFileSync(join(OUT, 'audit', `dom-${vp}.json`), `${JSON.stringify(report, null, 2)}\n`);
  await shoot(page, join(OUT, 'audit', `dom-${vp}.png`));
});
