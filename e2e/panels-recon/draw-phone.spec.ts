import { expect, test, type Locator, type Page } from '@playwright/test';
import { MAP, waitForCameraIdle, waitForMapIdle } from '../map-engine/helpers';

/**
 * panels-recon, round 5 R4-M2: DRAW on a phone (390×844, touch). Before the fix "Done" threw the
 * sketch away, only dblclick/Enter finished a line (neither exists on touch), and taps while
 * drawing also selected entities and opened their cards over the sheet.
 *
 * Proven here with real taps on the map canvas:
 *  - FINISH commits a line (2 taps) and a polygon (3 taps); DONE keeps a finishable line;
 *  - the sketch actions are ≥ 44 px tall;
 *  - while a tool is armed no tap reaches MapLibre's click (a bubble listener on the canvas
 *    container, exactly where MapLibre listens, counts none) and, when USGS is live, tapping a
 *    quake adds a vertex instead of opening its card — which the same tap does once DRAW is done.
 * The quake is placed at 22 % of the canvas height (mercator, pitch 0) so the sheet never covers it.
 */

const TILE = 512;
const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const latFromMercY = (y: number) => ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;

interface Quake {
  lat: number;
  lng: number;
  magnitude: number;
}

/** Camera centre that puts `q` `dyPx` above the canvas centre in mercator at `zoom`. */
function centreBelow(q: Quake, dyPx: number, zoom: number): { lat: number; lng: number } {
  const world = TILE * 2 ** zoom;
  return { lat: latFromMercY(mercY(q.lat) - (dyPx * 2 * Math.PI) / world), lng: q.lng };
}

async function strongestQuake(page: Page): Promise<Quake | null> {
  const res = await page.request.get('/api/earthquakes', { timeout: 60_000 }).catch(() => null);
  if (!res || res.status() !== 200) return null;
  const body = (await res.json()) as { items?: Quake[] };
  // Away from the poles so the mercator offset stays small and exact.
  const items = (body.items ?? []).filter((q) => Math.abs(q.lat) < 60);
  return items.length ? [...items].sort((a, b) => b.magnitude - a.magnitude)[0]! : null;
}

/** Count clicks that reach MapLibre's own listener position (bubble phase on the canvas container). */
async function spyMapClicks(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __mapClicks: number };
    w.__mapClicks = 0;
    document.querySelector('.maplibregl-canvas-container')!.addEventListener('click', () => {
      w.__mapClicks += 1;
    });
  });
  return () => page.evaluate(() => (window as unknown as { __mapClicks: number }).__mapClicks);
}

async function tapCanvas(canvas: Locator, x: number, y: number) {
  await canvas.tap({ position: { x, y }, timeout: 20_000 });
}

test.describe('panels-recon DRAW on a phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone layout (390×844, touch)');
  test.beforeEach(() => test.setTimeout(300_000));

  test('FINISH commits lines and polygons, DONE keeps a finishable line, taps never select while drawing', async ({ page }, info) => {
    const quake = await strongestQuake(page);
    const zoom = 6;
    // The map canvas fills the viewport (asserted below), so positions can be planned before boot.
    const vp = page.viewportSize()!;
    const box0 = { width: vp.width, height: vp.height };
    const canvas = page.locator('canvas.maplibregl-canvas');
    const target = { x: Math.round(box0.width / 2), y: Math.round(box0.height * 0.22) };
    const c = quake ? centreBelow(quake, box0.height / 2 - target.y, zoom) : { lat: 20, lng: 0 };
    await page.goto(`/?proj=mercator&layers=${quake ? 'earthquakes' : ''}&c=${c.lat.toFixed(5)},${c.lng.toFixed(5)},${zoom}`);
    await expect(canvas).toBeVisible({ timeout: 90_000 });
    const cb = (await canvas.boundingBox())!;
    // Sub-pixel sizes at device pixel ratio 2.625 (Pixel 7): 390.09 × 844.19.
    expect([cb.x, cb.y, Math.abs(cb.width - vp.width), Math.abs(cb.height - vp.height)].every((v) => v < 1), JSON.stringify(cb)).toBe(true);
    await expect(page.getByRole('status', { name: /loading/i })).toBeHidden({ timeout: 30_000 });
    await waitForMapIdle(page, 200_000);
    await waitForCameraIdle(page);
    const card = page.getByRole('button', { name: 'Close card' });

    // Control: with DRAW off, tapping the quake opens its card (selection works on this build).
    let selectable = false;
    if (quake) {
      await page.waitForResponse((r) => r.url().includes('/api/earthquakes'), { timeout: 30_000 }).catch(() => undefined);
      for (let i = 0; i < 20 && !selectable; i++) {
        await tapCanvas(canvas, target.x, target.y);
        selectable = await card.isVisible({ timeout: 1500 }).catch(() => false);
      }
      info.annotations.push({ type: 'control', description: selectable ? `tap on M${quake.magnitude} quake opened its card` : 'quake card did not open within 20 taps; selection check limited to the DOM spy' });
      if (selectable) {
        await card.tap();
        await expect(card).toBeHidden();
      }
    } else {
      info.annotations.push({ type: 'control', description: 'USGS offline or no quake: selection check limited to the DOM spy' });
    }

    // ROUTE tab → DRAW tab → Line.
    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /route/i }).tap();
    await page.getByRole('tab', { name: /draw/i }).tap();
    const panel = page.getByTestId('draw-panel');
    await panel.getByRole('button', { name: 'Line', exact: true }).tap();
    await expect(canvas).toHaveCSS('cursor', 'crosshair', { timeout: 30_000 });
    await expect(page.locator(MAP)).toHaveAttribute('data-map-tool', 'draw');
    await expect(panel).toContainText('Tap to add vertices, then tap FINISH.');
    const mapClicks = await spyMapClicks(page);
    await waitForCameraIdle(page);

    // Two taps (the first one on the quake) → a 2-vertex sketch; no card, no MapLibre click.
    await tapCanvas(canvas, target.x, target.y);
    await tapCanvas(canvas, Math.round(box0.width * 0.2), target.y + 40);
    await expect(panel.getByTestId('draw-sketch')).toHaveText(/^2 vertices · [\d.,]+ (NM|km|mi|ft|m)$/);
    await expect(card).toBeHidden();
    expect(await mapClicks()).toBe(0);

    const finish = panel.getByRole('button', { name: 'Finish' });
    for (const b of [finish, panel.getByRole('button', { name: 'Cancel the shape in progress' }), panel.getByRole('button', { name: 'Stop drawing' })]) {
      expect((await b.boundingBox())!.height, await b.innerText()).toBeGreaterThanOrEqual(44);
    }
    await finish.tap();
    await expect(panel.getByTestId('draw-measure')).toHaveCount(1);
    await expect(panel.getByTestId('draw-measure').first()).toHaveText(/^[\d.,]+ (NM|km|mi|ft|m)$/);
    await expect(panel.getByRole('button', { name: 'Line', exact: true })).toHaveAttribute('aria-pressed', 'true');

    // Polygon: FINISH waits for the third corner.
    await panel.getByRole('button', { name: 'Polygon', exact: true }).tap();
    await tapCanvas(canvas, Math.round(box0.width * 0.3), Math.round(box0.height * 0.16));
    await tapCanvas(canvas, Math.round(box0.width * 0.7), Math.round(box0.height * 0.16));
    await expect(panel.getByRole('button', { name: 'Finish' })).toBeDisabled();
    await tapCanvas(canvas, Math.round(box0.width * 0.5), Math.round(box0.height * 0.32));
    await panel.getByRole('button', { name: 'Finish' }).tap();
    await expect(panel.getByTestId('draw-measure')).toHaveCount(2);
    await expect(panel.getByTestId('draw-measure').nth(1)).toContainText(/(km²|mi²|ac|NM²|m²)/);

    // The reviewer's repro: Line, two taps, Done → the line is kept (it used to be cleared).
    await panel.getByRole('button', { name: 'Line', exact: true }).tap();
    await tapCanvas(canvas, Math.round(box0.width * 0.25), Math.round(box0.height * 0.3));
    await tapCanvas(canvas, Math.round(box0.width * 0.75), Math.round(box0.height * 0.3));
    await expect(panel.getByTestId('draw-sketch')).toContainText('2 vertices');
    await panel.getByRole('button', { name: 'Stop drawing' }).tap();
    await expect(panel.getByTestId('draw-measure')).toHaveCount(3);
    await expect(page.locator(MAP)).not.toHaveAttribute('data-map-tool', 'draw');
    await expect(card).toBeHidden();
    expect(await mapClicks()).toBe(0);
    await page.screenshot({ path: info.outputPath('draw-phone-finished.png') });

    // Tool off: the same tap selects again (MapLibre sees it; the quake card opens when it did before).
    await tapCanvas(canvas, target.x, target.y);
    await expect.poll(mapClicks).toBeGreaterThan(0);
    if (selectable) await expect(card).toBeVisible({ timeout: 10_000 });
  });
});
