import { expect, test, type Page } from '@playwright/test';
import { gotoMap, MAP, tokenPixels, waitForCameraIdle, waitForMapIdle } from '../map-engine/helpers';

/**
 * visual-qa round 5 MAJOR-1: flat point markers were clipped by the globe surface — at
 * `/?layers=malware&c=20.1825,80.0024,8` the globe drew 115 malware px against 807 in mercator, and
 * only the count labels at z5. The network/threats/maritime point layers now draw with
 * depthCompare 'always' plus a far-side filter. Checks: (1) the same malware hosts draw on the globe
 * at least half as many token pixels as in mercator; (2) hosts on the far side of the globe draw
 * nothing through it. The stream is answered from the page with a fixed host set (test data at the
 * reviewer's coordinates; the layer under test is the drawing, not URLhaus).
 */

const CENTER = { lat: 20.1825, lng: 80.0024 };
const host = (i: number, lat: number, lng: number) => ({
  id: `198.51.100.${i}`,
  ip: `198.51.100.${i}`,
  lat,
  lng,
  observedAt: '2026-09-30T19:54:23.000Z',
  source: 'urlhaus',
  port: 80,
  threat: 'malware_download',
  family: 'Mozi',
  urlCount: 1,
  online: true,
  asn: null,
  country: 'Testland',
  city: null,
  geoPrecision: 'city',
  urlhausReference: null,
  firstSeen: null,
});
// Twelve hosts on a 3 × 4 grid around the centre (≈ 13 km apart: twelve separate discs at z8).
const HOSTS = Array.from({ length: 12 }, (_, i) => host(i + 1, CENTER.lat + (Math.floor(i / 4) - 1) * 0.12, CENTER.lng + ((i % 4) - 1.5) * 0.12));
const CLIP = { x0: 0.3, y0: 0.3, x1: 0.7, y1: 0.7 };

async function openMalware(page: Page, proj: 'globe' | 'mercator', camera: { lat: number; lng: number; zoom: number }) {
  const meta = { feed: 'malware', state: 'live', fetchedAt: '2026-09-30T20:00:00.000Z', observedAt: '2026-09-30T19:54:23.000Z', lastGoodAt: '2026-09-30T20:00:00.000Z', stale: false, ttlSeconds: 300, kind: 'live', attribution: [] };
  const snap = JSON.stringify({ items: HOSTS, meta, providers: {} });
  await page.route('**/api/malware/stream', (route) => route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: `retry: 600000\n\nevent: snapshot\ndata: ${snap}\n\n` }));
  await gotoMap(page, { camera, params: { proj, layers: 'malware' } });
  await waitForMapIdle(page);
  await expect(page.locator('[data-testid="map-root"]')).toHaveAttribute('data-projection', proj, { timeout: 30_000 });
  await expect(page.locator(MAP)).toHaveAttribute('data-admission-pending', '0', { timeout: 120_000 });
  // The snapshot landed: the rail counts the twelve hosts.
  await page.getByRole('button', { name: 'NETWORK INTEL' }).click();
  await expect(page.getByRole('button', { name: /Live Malware/ })).toContainText('12', { timeout: 60_000 });
  await page.keyboard.press('Escape');
  await waitForCameraIdle(page);
}

/** Highest malware-token pixel count over a few frames (SwiftShader draws late). */
async function sample(page: Page, frames: number): Promise<number> {
  let best = 0;
  for (let i = 0; i < frames; i++) {
    best = Math.max(best, await tokenPixels(page, '--map-malware', CLIP));
    await page.waitForTimeout(1_500);
  }
  return best;
}

test.describe('point markers on the globe (visual-qa r5 MAJOR-1)', () => {
  test('malware hosts draw whole discs on the globe (≥ half the mercator pixels)', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'desktop pixel check (1600×1000)');
    test.setTimeout(300_000);
    const camera = { ...CENTER, zoom: 8 };
    await openMalware(page, 'mercator', camera);
    await expect.poll(() => tokenPixels(page, '--map-malware', CLIP), { timeout: 60_000 }).toBeGreaterThan(100);
    const mercator = await sample(page, 3);
    await openMalware(page, 'globe', camera);
    await expect.poll(() => tokenPixels(page, '--map-malware', CLIP), { timeout: 60_000 }).toBeGreaterThan(0);
    const globe = await sample(page, 3);
    console.log(`malware px at z8: globe=${globe} mercator=${mercator}`);
    expect(globe).toBeGreaterThanOrEqual(mercator * 0.5);
  });

  test('hosts on the far side of the globe draw nothing through it', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'desktop pixel check (1600×1000)');
    test.setTimeout(300_000);
    await openMalware(page, 'globe', { ...CENTER, zoom: 2 });
    await expect.poll(() => tokenPixels(page, '--map-malware', CLIP), { timeout: 60_000 }).toBeGreaterThan(10);
    const near = await sample(page, 2);
    // Camera over the antipode: the hosts sit exactly behind the globe's centre.
    await openMalware(page, 'globe', { lat: -CENTER.lat, lng: CENTER.lng - 180, zoom: 2 });
    const far = await sample(page, 4);
    console.log(`malware px at z2: facing=${near} far side=${far}`);
    expect(far).toBeLessThan(5);
  });
});
