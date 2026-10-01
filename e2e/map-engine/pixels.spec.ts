import { expect, test } from '@playwright/test';
import { countTokenPixels, decodePng, firstTokenFrame, tokenPixels, tokenRgb } from './helpers';

/**
 * The pixel tools the route specs rely on, checked against Chromium's own PNG output on a
 * synthetic canvas (no app server needed): the Node PNG decoder returns exactly the pixels the
 * page drew, the blended-token rule counts a 60 %-alpha gold line and an opaque dot but not the
 * dark map or the other warm map colours (earthquakes, amber airport rings, night lights), and the
 * screencast helper reports a frame that shows the token.
 */

const W = 400;
const H = 200;

/** Dark map (#05070D) with: a 300 px gold line at alpha 0.6 over a 15 % glow, a 4 px opaque gold dot, and decoys. */
const SCENE = `<!doctype html><html><head><style>
:root { --map-route-planned: #d4af37; }
html, body { margin: 0; background: #05070d; }
canvas { display: block; width: ${W}px; height: ${H}px; }
</style></head><body><canvas class="maplibregl-canvas" width="${W}" height="${H}"></canvas><script>
const c = document.querySelector('canvas').getContext('2d');
c.fillStyle = '#05070d'; c.fillRect(0, 0, ${W}, ${H});
// Quadrant probes for the decoder (exact colours).
c.fillStyle = 'rgb(10, 200, 30)'; c.fillRect(0, 0, 10, 10);
c.fillStyle = 'rgb(250, 5, 128)'; c.fillRect(${W - 10}, ${H - 10}, 10, 10);
// Route: 6 px glow at 15 %, then the 2 px line at 60 % (horizontal, 300 px).
c.fillStyle = 'rgba(212, 175, 55, 0.15)'; c.fillRect(50, 97, 300, 6);
c.fillStyle = 'rgba(212, 175, 55, 0.6)'; c.fillRect(50, 99, 300, 2);
// Comet head: 4 px radius, opaque.
c.fillStyle = 'rgb(212, 175, 55)'; c.beginPath(); c.arc(200, 40, 4, 0, Math.PI * 2); c.fill();
// Decoys: M<4 quake fill (#f9a825 at 0.75), amber airport ring (#ffb300), Black Marble-like lights, seismic orange.
c.fillStyle = 'rgba(249, 168, 37, 0.75)'; c.fillRect(20, 150, 30, 30);
c.fillStyle = 'rgb(255, 179, 0)'; c.fillRect(80, 150, 30, 30);
c.fillStyle = 'rgba(255, 214, 150, 0.8)'; c.fillRect(140, 150, 30, 30);
c.fillStyle = 'rgb(230, 81, 0)'; c.fillRect(200, 150, 30, 30);
</script></body></html>`;

test.describe('route pixel tools', () => {
  test.beforeEach(({ browserName }, info) => {
    test.skip(info.project.name === 'mobile' || browserName !== 'chromium', 'desktop Chromium (CDP screencast, DPR 1)');
  });

  test('decodes Chromium PNGs exactly and counts the blended token, not the decoys', async ({ page }) => {
    await page.setViewportSize({ width: W, height: H });
    await page.setContent(SCENE);
    const png = await page.screenshot({ clip: { x: 0, y: 0, width: W, height: H } });
    const img = decodePng(png);
    expect([img.width, img.height]).toEqual([W, H]);
    const at = (x: number, y: number) => Array.from(img.data.subarray((y * W + x) * img.channels, (y * W + x) * img.channels + 3));
    expect(at(5, 5)).toEqual([10, 200, 30]);
    expect(at(W - 5, H - 5)).toEqual([250, 5, 128]);
    expect(at(300, 20)).toEqual([5, 7, 13]);
    const rgb = await tokenRgb(page, '--map-route-planned');
    expect(rgb).toEqual([212, 175, 55]);
    const count = (x: number, y: number, width: number, height: number) => countTokenPixels(img, rgb, { x, y, width, height });
    // The 2 px line at 60 % over its glow: 600 px (and nothing of the 15 % glow on its own).
    expect(count(40, 90, 320, 20)).toBe(600);
    // The opaque comet head (≈ π·4² px, antialiased edge excluded below alpha 0.4).
    expect(count(190, 30, 20, 20)).toBeGreaterThanOrEqual(40);
    expect(count(190, 30, 20, 20)).toBeLessThanOrEqual(60);
    // Dark map and warm decoys: nothing.
    expect(count(0, 140, W, 60)).toBe(0);
    expect(count(300, 10, 90, 70)).toBe(0);
    // The same through the page helper (screenshot of the canvas).
    expect(await tokenPixels(page, '--map-route-planned', { x0: 0, y0: 0, x1: 1, y1: 1 })).toBe(count(0, 0, W, H));
  });

  test('reports the first composited frame that shows the token', async ({ page }) => {
    await page.setViewportSize({ width: W, height: H });
    await page.setContent(SCENE);
    const before = Date.now();
    const frame = await firstTokenFrame(page, '--map-route-planned', { minPx: 600, timeoutMs: 30_000, rect: { x0: 0, y0: 0, x1: 1, y1: 1 } });
    expect(frame).not.toBeNull();
    expect(frame!.px).toBeGreaterThanOrEqual(600);
    // A compositor timestamp from this run (same machine clock), not a made-up value.
    expect(Math.abs(frame!.epochMs - before)).toBeLessThan(30_000);
    expect(await firstTokenFrame(page, '--map-route-planned', { minPx: 100_000, timeoutMs: 2_000, rect: { x0: 0, y0: 0, x1: 1, y1: 1 } })).toBeNull();
  });
});
