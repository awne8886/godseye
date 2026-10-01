import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Visual-QA checks (§7, map engine): per-deck-layer-type baselines on the globe and in mercator,
 * far-side occlusion, picking on both projections, and the 2D → globe toggle. Runs with
 * docs/screenshots/playwright.config.ts against a running build; shots go to
 * `<CAPTURE_PNG_DIR>/deck|checks/*.png`. Baselines use the app's own layers on live keyless data —
 * nothing is staged, so a layer whose feed is offline is captured in its honest offline state.
 */

const OUT = process.env.CAPTURE_PNG_DIR ?? dirname(fileURLToPath(import.meta.url));
const MAP = '[data-testid="map-root"] .maplibregl-map';
const ROOT = '[data-testid="map-root"]';

async function boot(page: Page, qs: string): Promise<void> {
  await page.goto(`/?${qs}`);
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole('status', { name: /loading/i })).toBeHidden({ timeout: 30_000 });
  await expect(page.locator(MAP)).toHaveAttribute('data-style-ready', 'true', { timeout: 30_000 }).catch(() => undefined);
}

async function entities(page: Page, timeout = 60_000): Promise<boolean> {
  return page
    .waitForFunction(() => /(^|\D)[1-9][\d,]* ENTITIES/.test(document.querySelector('[aria-label="Telemetry"]')?.textContent ?? ''), undefined, { timeout })
    .then(() => true)
    .catch(() => false);
}

async function shoot(page: Page, rel: string): Promise<void> {
  const file = join(OUT, rel);
  mkdirSync(dirname(file), { recursive: true });
  await page.screenshot({
    path: file,
    mask: [page.locator('.hud-ticker'), page.getByText(/^UTC \d\d:\d\d · LOCAL/), page.getByText(/^ZULU /)],
    maskColor: '#04040A',
    animations: 'disabled',
    timeout: 60_000,
  });
}

/**
 * Deck layer type → the app layer that renders it, with a camera that shows it. TripsLayer is not
 * used by any shipped layer (watched-flight trails are a PathLayer), so its baseline is the trail.
 */
const DECK: Array<[type: string, layers: string, cam: string, extra?: string]> = [
  ['arc-greatcircle', 'cyber_attacks,cf_attacks', '30,20,1.6'],
  ['icon', 'flights,private,jets,military', '51,0,5'],
  ['text', 'satellites', '20,0,2.2'],
  ['h3', 'gps_jam', '50,30,3.5'],
  ['scatter', 'earthquakes', '10,-80,2'],
  ['trail-path', 'flights', '52.2,-41.3,2.6', 'route=LHR-JFK'],
];

test.describe('deck baselines', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop baselines');
  for (const [type, layers, cam, extra] of DECK) {
    for (const proj of ['globe', 'mercator'] as const) {
      test(`deck/${type}-${proj}`, async ({ page }) => {
        await boot(page, `layers=${layers}&c=${cam}&proj=${proj}${extra ? `&${extra}` : ''}`);
        const drew = await entities(page);
        if (!drew) test.info().annotations.push({ type: 'env', description: 'no entities within 60 s' });
        await page.waitForTimeout(6000);
        await expect(page.locator(ROOT)).toHaveAttribute('data-projection', proj);
        await shoot(page, `deck/${type}-${proj}-desktop.png`);
      });
    }
  }
});

test('checks/far-side occlusion (globe, dense global layers, antipode hidden)', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'desktop');
  test.setTimeout(360_000);
  for (const [name, cam] of [['atlantic', '0,0,1.5'], ['pacific', '0,179,1.5']] as const) {
    await boot(page, `layers=satellites,flights,earthquakes,malware&c=${cam}`);
    await entities(page);
    await page.waitForTimeout(8000);
    await expect(page.locator(ROOT)).toHaveAttribute('data-projection', 'globe');
    await shoot(page, `checks/far-side-${name}-desktop.png`);
  }
});

/** Picking: centre on the strongest current quake and click it — the card must open on both projections. */
for (const proj of ['globe', 'mercator'] as const) {
  test(`checks/picking-${proj}`, async ({ page }, info) => {
    const r = await page.request.get('/api/earthquakes', { timeout: 30_000 });
    test.skip(!r.ok(), 'earthquake feed offline');
    const d = (await r.json()) as { items: Array<{ lat: number; lng: number; magnitude: number }> };
    test.skip(!d.items?.length, 'no quakes reported');
    const q = [...d.items].sort((a, b) => b.magnitude - a.magnitude)[0]!;
    await boot(page, `layers=earthquakes&c=${q.lat},${q.lng},5&proj=${proj}`);
    expect(await entities(page)).toBe(true);
    await page.waitForTimeout(4000);
    const v = page.viewportSize()!;
    await page.mouse.click(v.width / 2, v.height / 2);
    await expect(page.locator('[data-testid="hazard-card"], [data-testid$="-card"]').first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1200);
    await shoot(page, `checks/picking-${proj}-${info.project.name}.png`);
  });
}

test('checks/2d-to-globe toggle', async ({ page }, info) => {
  await boot(page, 'layers=flights,earthquakes&c=20,10,2.5&proj=mercator');
  await expect(page.locator(ROOT)).toHaveAttribute('data-projection', 'mercator');
  await page.waitForTimeout(5000);
  await shoot(page, `checks/toggle-1-mercator-${info.project.name}.png`);
  await page.getByRole('button', { name: '3D' }).click();
  await expect(page.locator(ROOT)).toHaveAttribute('data-projection', 'globe', { timeout: 15_000 });
  await expect(page).not.toHaveURL(/proj=mercator/);
  await page.waitForTimeout(5000);
  expect(Number(await page.locator(MAP).getAttribute('data-map-loads'))).toBe(1);
  await shoot(page, `checks/toggle-2-globe-${info.project.name}.png`);
});
