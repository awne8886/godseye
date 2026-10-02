import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * design-system-hud, Phase 3 round 9 minors (imagery chips on phones).
 * - Landscape 844x390 with a sheet open: the credits wrapped to 4 lines and the chip control shrank
 *   until the folded summary chip was clipped out of view (a degraded basemap gave no signal on the
 *   map). The chip control now always keeps one row.
 * - Portrait 390x844: a long summary chip wrapped to the full width and touched the left screen edge
 *   (10 px inset on the right only). The chip controls now take the same inset on both sides.
 * The basemap tiles are intercepted (the first one answered with an empty tile, the rest held or
 * aborted) so the chip text is deterministic and no live tile host decides the outcome.
 * Each test sets its own viewport and runs once (desktop project).
 */
test.describe.configure({ timeout: 180_000 });

const TILES = /tiles\.openfreemap\.org\/planet\/.+\.pbf/;
const emptyTile = (route: Route) => route.fulfill({ status: 200, contentType: 'application/x-protobuf', body: Buffer.alloc(0) });

async function boot(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole('status', { name: /loading/i })).toBeHidden({ timeout: 45_000 });
}

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The summary chip's box and its visible intersection with the viewport and with its clipping control. */
async function summaryVisibility(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('[data-testid="imagery-chip-summary"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const c = el.closest('.maplibregl-ctrl')!.getBoundingClientRect();
    const cut = (a: DOMRect | { left: number; top: number; right: number; bottom: number }) => ({
      width: Math.max(0, Math.min(r.right, a.right) - Math.max(r.left, a.left)),
      height: Math.max(0, Math.min(r.bottom, a.bottom) - Math.max(r.top, a.top)),
    });
    return {
      text: el.textContent ?? '',
      chip: { x: r.left, y: r.top, width: r.width, height: r.height },
      inViewport: cut({ left: 0, top: 0, right: innerWidth, bottom: innerHeight }),
      inControl: cut(c),
    };
  });
}

test.describe('landscape phone 844x390 with a sheet open', () => {
  test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('r9 m: the folded imagery summary chip keeps its own row under 4-line credits', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'sets its own viewport; once');
    // One basemap tile arrives, the rest never do: BASEMAP LOADING (stalled, with the last tile time).
    let n = 0;
    await page.route(TILES, (route) => (n++ < 1 ? emptyTile(route) : undefined));
    await boot(page, '/?layers=day_night,gibs_truecolor,terrain_3d&panel=layers');
    await expect(page.getByTestId('mobile-sheet')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-sheet-occupied', '');
    const attrib = page.locator('.maplibregl-ctrl-attrib');
    await expect(attrib).toContainText('OpenStreetMap', { timeout: 60_000 });
    await expect(page.getByTestId('imagery-chip-summary')).toContainText('BASEMAP LOADING', { timeout: 60_000 });
    // The sheet's spring and the chips settle.
    await page.waitForTimeout(1500);

    const credits = (await attrib.boundingBox())!;
    // The case from the finding: the credits wrap to several lines in the column right of the view bar.
    expect(credits.height, 'credits wrap to several lines').toBeGreaterThan(30);

    const v = (await summaryVisibility(page))!;
    expect(v, 'summary chip rendered').not.toBeNull();
    expect(v.inViewport.width * v.inViewport.height, `summary chip in the viewport (${v.text})`).toBeGreaterThan(0);
    expect(v.inControl.width * v.inControl.height, `summary chip inside its clipping control (${v.text})`).toBeGreaterThan(0);
    // Not just a sliver: the whole chip row is painted.
    expect(v.inControl.height, 'summary chip not clipped').toBeGreaterThanOrEqual(v.chip.height - 1);

    // The round-8 guarantees still hold: credits and chip clear the telemetry, view bar and sheet.
    const telemetry = (await page.locator('[data-map-inset="telemetry"]').boundingBox())!;
    const viewBar = (await page.getByTestId('view-controls').boundingBox())!;
    const sheet = (await page.getByTestId('mobile-sheet').boundingBox())!;
    for (const [label, b] of [['telemetry', telemetry], ['view bar', viewBar]] as const) {
      expect(overlaps(credits, b), `credits vs ${label}`).toBe(false);
      expect(overlaps(v.chip, b), `summary chip vs ${label}`).toBe(false);
    }
    expect(credits.y + credits.height, 'credits above the sheet').toBeLessThanOrEqual(sheet.y);
    expect(v.chip.y + v.chip.height, 'summary chip above the credits').toBeLessThanOrEqual(credits.y);
    // The sheet stays usable (30vh floor).
    expect(sheet.height).toBeGreaterThanOrEqual(Math.floor(0.3 * 390));
    await info.attach('landscape-844x390-chips.png', { body: await page.screenshot(), contentType: 'image/png' });
  });
});

test.describe('portrait phone 390x844', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('r9 m: a long wrapped imagery chip keeps an inset from both screen edges', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'sets its own viewport; once');
    // One basemap tile arrives, every other one fails: BASEMAP OFFLINE · LAST TILE hh:mm UTC · RETRYING.
    let n = 0;
    await page.route(TILES, (route) => (n++ < 1 ? emptyTile(route) : route.abort()));
    await boot(page, '/?layers=day_night,gibs_truecolor');
    const summary = page.getByTestId('imagery-chip-summary');
    await expect(summary).toContainText(/BASEMAP OFFLINE · LAST TILE \d\d:\d\d UTC · RETRYING/, { timeout: 90_000 });
    await page.waitForTimeout(1000);
    // The long case from the finding: the chip wraps to two lines.
    expect((await summary.boundingBox())!.height, 'summary chip wraps').toBeGreaterThan(30);

    const edges = () =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[data-testid^=imagery-chip]')].map((el) => {
          const r = el.getBoundingClientRect();
          return { id: el.dataset.testid!, left: r.left, right: innerWidth - r.right };
        }),
      );
    const check = (list: Awaited<ReturnType<typeof edges>>) => {
      expect(list.length).toBeGreaterThan(0);
      for (const e of list) {
        expect(e.left, `${e.id} left edge`).toBeGreaterThanOrEqual(8);
        expect(e.right, `${e.id} right edge`).toBeGreaterThanOrEqual(8);
      }
    };
    check(await edges());
    await info.attach('portrait-390x844-folded.png', { body: await page.screenshot(), contentType: 'image/png' });

    // Expanded, every chip in the list keeps the same inset.
    await page.getByRole('button', { name: /Imagery on the map: .* Show all/ }).click();
    await expect(page.getByRole('button', { name: /Hide the \d+ imagery notes/ })).toBeVisible();
    check(await edges());
    await info.attach('portrait-390x844-expanded.png', { body: await page.screenshot(), contentType: 'image/png' });
  });
});
