import { expect, test } from '@playwright/test';
import { isFacing } from '../../src/lib/map/far-side';
import { gibsTrueColorDate } from '../../src/lib/map/imagery';
import { collectErrors, gotoMap, MAP, mapLoads, mapProjection, nudgeMap, readCamera, readFarSideCamera, waitForMapIdle, waitForMapStyle } from './helpers';

test.describe('map engine', () => {
  // Tiles come straight from the upstream hosts; allow for slow egress in sandboxes.
  test.describe.configure({ timeout: 240_000 });
  test('loads with no console errors and a visible attribution', async ({ page }) => {
    const errors = collectErrors(page);
    await gotoMap(page);
    await waitForMapIdle(page);
    await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('OpenStreetMap');
    // Day/night is on by default: its dated REFERENCE chip is shown with the night lights.
    await expect(page.getByTestId('imagery-chip-night')).toHaveText('BLACK MARBLE 2016 · REFERENCE');
    await page.waitForTimeout(1500); // late tile/sprite/worker errors
    expect(errors).toEqual([]);
  });

  test('far-side occlusion: the published camera hides the antipode, shows the centre', async ({ page }) => {
    // Only the camera matters here (not tiles), so no idle wait: drag until a moveend is recorded.
    const farSideAfterNudge = async () => {
      await expect
        .poll(async () => {
          await nudgeMap(page);
          return readFarSideCamera(page);
        }, { timeout: 60_000, intervals: [1000] })
        .not.toBeNull();
      return (await readFarSideCamera(page))!;
    };
    await gotoMap(page, { camera: { lat: 0, lng: 0, zoom: 1.8 } });
    const cam = await farSideAfterNudge();
    expect(cam.altitude).toBeGreaterThan(1_000_000); // whole-globe view
    expect(isFacing([cam.lng, cam.lat], cam)).toBe(true);
    expect(isFacing([cam.lng + 180, -cam.lat], cam)).toBe(false); // antipode
    expect(isFacing([cam.lng + 100, 0], cam)).toBe(false); // beyond the limb
    // Across the antimeridian from a Pacific view.
    await gotoMap(page, { camera: { lat: 0, lng: 179, zoom: 1.8 } });
    const pacific = await farSideAfterNudge();
    expect(Math.abs(pacific.lng)).toBeGreaterThan(150);
    expect(isFacing([-179, 0], pacific)).toBe(true);
    expect(isFacing([178, 0], pacific)).toBe(true);
    expect(isFacing([0, 0], pacific)).toBe(false);
  });

  test('2D → globe toggle switches the applied projection without remounting', async ({ page }) => {
    await gotoMap(page, { camera: { lat: 20, lng: 10, zoom: 2.5, pitch: 30, bearing: 0 } });
    await waitForMapStyle(page);
    expect(await mapProjection(page)).toBe('globe');
    await page.getByRole('button', { name: '2D' }).click();
    await expect(page).toHaveURL(/proj=mercator/);
    await expect(page.locator('[data-testid="map-root"]')).toHaveAttribute('data-projection', 'mercator');
    // Pitch eases to 0 in 2D.
    await expect.poll(async () => (await readCamera(page))?.pitch ?? -1, { timeout: 5000 }).toBe(0);
    await expect.poll(() => readFarSideCamera(page)).toBeNull();
    await page.getByRole('button', { name: '3D' }).click();
    await expect(page.locator('[data-testid="map-root"]')).toHaveAttribute('data-projection', 'globe');
    expect(await mapLoads(page)).toBe(1);
  });

  test('SAT toggle keeps the map mounted and shows Esri imagery with its attribution', async ({ page }) => {
    await gotoMap(page, { camera: { lat: 48.85, lng: 2.35, zoom: 5 } });
    const sat = page.getByRole('button', { name: /^SAT$|Satellite View/ });
    test.skip((await sat.count()) === 0, 'MAP | SAT control is mounted by design-system-hud');
    await waitForMapStyle(page);
    const canvas = await page.locator('canvas.maplibregl-canvas').elementHandle();
    await sat.first().click();
    await expect(page.locator('[data-testid="map-root"]')).toHaveAttribute('data-basemap', 'satellite');
    await expect(page.getByTestId('imagery-chip-esri')).toBeVisible();
    await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community');
    // Same canvas element, one map construction: nothing was remounted.
    expect(await page.locator('canvas.maplibregl-canvas').evaluate((el, prev) => el === prev, canvas)).toBe(true);
    expect(await mapLoads(page)).toBe(1);
    await page.getByRole('button', { name: /^MAP$|Night Mode/ }).first().click();
    await expect(page.locator('[data-testid="map-root"]')).toHaveAttribute('data-basemap', 'dark');
    expect(await mapLoads(page)).toBe(1);
  });

  test('terrain engages in mercator at z ≥ 10 after settling and releases below 9.5', async ({ page }) => {
    await gotoMap(page, { camera: { lat: 46.55, lng: 7.98, zoom: 11, pitch: 50, bearing: 0 }, params: { layers: 'terrain_elevation' } });
    const root = page.locator('[data-testid="map-root"]');
    await expect(root).toHaveAttribute('data-projection', 'mercator', { timeout: 90_000 });
    await expect(page.getByTestId('imagery-chip-terrain')).toHaveText(/Loading nearby terrain…|Terrain on/);
    const box = (await page.locator('canvas.maplibregl-canvas').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect
      .poll(async () => {
        await page.mouse.wheel(0, 1200);
        return root.getAttribute('data-projection');
      }, { timeout: 30_000, intervals: [500] })
      .toBe('globe');
    await expect(page.getByTestId('imagery-chip-terrain')).toHaveText('Terrain at zoom 10+ · zoom in');
  });

  test('GIBS true colour shows the previous UTC day, badged REFERENCE', async ({ page }) => {
    await gotoMap(page, { camera: { lat: 10, lng: 20, zoom: 2 }, params: { layers: 'gibs_truecolor' } });
    await expect(page.getByTestId('imagery-chip-gibs')).toHaveText(`VIIRS TRUE COLOUR ${gibsTrueColorDate(Date.now())} · REFERENCE`, { timeout: 60_000 });
    await expect(page.getByTestId('imagery-chip-night')).toHaveCount(0); // day_night not in ?layers=
  });

  test('double right-click opens the Region Dossier at the pointer; a slow pair does not', async ({ page, isMobile }) => {
    test.skip(isMobile, 'right-click is a desktop gesture (touch uses long-press)');
    await gotoMap(page, { camera: { lat: 48.85, lng: 2.35, zoom: 6 } });
    // Input timestamps are taken when the browser receives the event: let the style/shader
    // compilation long tasks pass so the pair is not stretched past 500 ms by a busy main thread.
    await waitForMapStyle(page);
    await page.waitForTimeout(3000);
    const box = (await page.locator('canvas.maplibregl-canvas').boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.click(x, y, { button: 'right' });
    await page.waitForTimeout(700); // > 500 ms: not a double right-click
    await page.mouse.click(x + 3, y + 3, { button: 'right' });
    await page.waitForTimeout(1500);
    expect(page.url()).not.toContain('dossier=');
    await page.waitForTimeout(700);
    await page.mouse.click(x, y, { button: 'right' });
    await page.mouse.click(x + 4, y + 2, { button: 'right' });
    await expect(page).toHaveURL(/dossier=4[6-9]\.\d+(%2C|,)[0-4]\.\d+/, { timeout: 10_000 });
  });

  test('startup budget: one WebGL canvas (no probe contexts), night lights off the main thread', async ({ page }) => {
    await page.addInitScript(() => {
      const canvases = new Set<HTMLCanvasElement>();
      const w = window as unknown as { __webglCanvases: () => number };
      w.__webglCanvases = () => canvases.size;
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (/^webgl/.test(type)) canvases.add(this);
        return (orig as (...a: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof orig;
    });
    const workers: string[] = [];
    page.on('worker', (w) => workers.push(w.url()));
    await gotoMap(page);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __webglCanvases: () => number }).__webglCanvases()), { timeout: 30_000 }).toBe(1);
    await page.waitForTimeout(3000);
    // MapLibre and the interleaved deck overlay share the map's canvas: nothing else creates a context.
    expect(await page.evaluate(() => (window as unknown as { __webglCanvases: () => number }).__webglCanvases())).toBe(1);
    expect(workers.length).toBeGreaterThan(0); // geometry worker (terminator + night-lights pipeline)
  });

  test('camera from ?c= is restored and longitudes stay wrapped', async ({ page }) => {
    await gotoMap(page, { camera: { lat: 35.68, lng: 139.69, zoom: 6 } });
    await waitForMapIdle(page);
    await nudgeMap(page);
    await expect.poll(() => readCamera(page)).not.toBeNull();
    const cam = (await readCamera(page))!;
    expect(cam.lat).toBeCloseTo(35.68, 0);
    expect(cam.lng).toBeGreaterThan(-180);
    expect(cam.lng).toBeLessThanOrEqual(180);
    await expect(page.locator(MAP)).toHaveAttribute('data-map-loads', '1');
  });
});
