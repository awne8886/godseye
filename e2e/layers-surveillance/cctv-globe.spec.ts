import { expect, test, type Page } from '@playwright/test';
import { isFacing } from '../../src/lib/map/far-side';
import { gotoMap, tokenPixels, waitForAdmissionDrained, waitForCameraIdle, waitForMapIdle, type CanvasRect } from '../map-engine/helpers';

/**
 * Round 5, visual-qa MAJOR-1 (layers-surveillance): flat camera markers on the globe were clipped by
 * the globe surface (half discs, broken rings or nothing). They now draw with depthCompare 'always'
 * and cullMode 'none', so the far-side filter is what hides cameras behind the limb — from drawing
 * and from picking. Runs against the live /api/cctv; skipped (not failed) when the operators needed
 * are SOURCE OFFLINE right now.
 */

type Row = (string | number | null)[];
interface Catalogue {
  fields: string[];
  rows: Row[];
}

/** The map canvas centre, clear of the docked panels (fractions of the canvas). */
const CENTRE: CanvasRect = { x0: 0.3, y0: 0.3, x1: 0.7, y1: 0.7 };

async function liveRows(page: Page, region: string): Promise<number> {
  const res = await page.request.get(`/api/cctv?region=${region}`, { timeout: 90_000 });
  if (!res.ok()) return 0;
  return ((await res.json()) as Catalogue).rows.length;
}

test.describe('cctv on the globe', () => {
  test.describe.configure({ timeout: 300_000 });

  test('camera points are whole discs on the globe, not clipped by its surface (globe px ≥ ½ mercator px)', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'desktop pixel check');
    test.skip((await liveRows(page, 'us-west')) === 0, 'us-west camera providers SOURCE OFFLINE right now');
    const status = page.getByTestId('cctv-far-side');
    const px: Record<string, number> = {};
    for (const proj of ['mercator', 'globe']) {
      // Los Angeles at z9: dense Caltrans D7 coverage in the centre of the canvas.
      await gotoMap(page, { camera: { lat: 34.05, lng: -118.25, zoom: 9 }, params: { proj, layers: 'cctv' } });
      await waitForMapIdle(page);
      await expect(page.locator('[data-testid="map-root"]')).toHaveAttribute('data-projection', proj, { timeout: 30_000 });
      await expect(status).toHaveAttribute('data-drawn', /^[1-9]\d*$/, { timeout: 120_000 });
      await waitForCameraIdle(page);
      // Count only once deck has admitted and drawn every layer: on SwiftShader the camera dots
      // reach the canvas ~8 s after data-drawn (r10 MINOR 4: a fixed 2.5 s wait counted 0 px).
      await waitForAdmissionDrained(page);
      px[proj] = await tokenPixels(page, '--map-cctv', CENTRE, { minAlpha: 0.3 });
    }
    test.info().annotations.push({ type: 'cctv px', description: JSON.stringify(px) });
    expect(px.mercator!).toBeGreaterThan(40);
    expect(px.globe!).toBeGreaterThanOrEqual(0.5 * px.mercator!);
  });

  test('cameras behind the limb are not drawn (the far-side filter matches isFacing for every camera)', async ({ page }) => {
    const bodies = new Map<string, Catalogue>();
    page.on('response', async (r) => {
      const m = /\/api\/cctv\?region=([a-z-]+)$/.exec(r.url());
      if (!m || r.status() !== 200) return;
      const body = (await r.json().catch(() => null)) as Catalogue | null;
      if (body?.rows) bodies.set(m[1]!, body);
    });
    // Over Hong Kong at z3: the camera sees ≈ 66°, so the Americas and Europe are behind the limb.
    await gotoMap(page, { camera: { lat: 22.3, lng: 114.17, zoom: 3 }, params: { proj: 'globe', layers: 'cctv' } });
    await waitForMapIdle(page);
    const status = page.getByTestId('cctv-far-side');
    await expect(status).toHaveAttribute('data-camera', /^-?\d/, { timeout: 120_000 });
    await waitForCameraIdle(page);

    const checked: { v: { drawn: number; total: number; facing: number } | null } = { v: null };
    await expect
      .poll(
        async () => {
          const total = Number(await status.getAttribute('data-total'));
          const rows = [...bodies.values()].flatMap((b) => b.rows.map((r) => ({ lng: Number(r[b.fields.indexOf('lng')]), lat: Number(r[b.fields.indexOf('lat')]) })));
          if (!total || rows.length !== total) return 'waiting for the page and this test to see the same catalogue';
          const [lng, lat, altitude] = (await status.getAttribute('data-camera'))!.split(',').map(Number) as [number, number, number];
          const facing = rows.filter((p) => isFacing(p, { lng, lat, altitude })).length;
          checked.v = { drawn: Number(await status.getAttribute('data-drawn')), total, facing };
          return 'ok';
        },
        { timeout: 180_000, intervals: [2_000] },
      )
      .toBe('ok');
    const c = checked.v!;
    test.info().annotations.push({ type: 'cctv far side', description: JSON.stringify(c) });
    test.skip(c.total === c.facing, 'every loaded camera faces this view (other regions SOURCE OFFLINE right now)');
    // The camera key is rounded (0.001°, 1 m): only cameras exactly on the horizon may differ.
    expect(Math.abs(c.drawn - c.facing)).toBeLessThanOrEqual(2);
    expect(c.drawn).toBeLessThan(c.total);
  });
});
