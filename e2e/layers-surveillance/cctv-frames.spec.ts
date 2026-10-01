import { expect, test, type Page } from '@playwright/test';

/**
 * Round 4, item 2 (R2 MINOR-1): an operator answering its still URLs with an HTML page (Transport
 * for NSW, 2026-09-30 → 10-01) must surface as SOURCE OFFLINE / CAMERA OFFLINE — a JSON refusal from
 * the stills proxy, FRAMES UNAVAILABLE for the provider, placeholder tiles and an offline viewer —
 * never as a broken image. Runs against the live operators: when NSW serves images again the
 * outage assertions are skipped and only "no broken image anywhere" is checked.
 * Round-4 review: an operator is judged on at least 5 cameras, and tiles keep requesting their own
 * frame (a SOURCE OFFLINE tile always carries the last good relay time or "NO FRAME IN 10 MIN").
 * Item 1: every relayed frame carries its fetch time separately from the operator's frame time.
 */

type Row = (string | number | null)[];

async function nswCameras(page: Page): Promise<{ id: string; lat: number; lng: number }[] | null> {
  // A cold region answers 503 with `pendingRegions` after its 12 s budget: retry like the client does.
  let res = await page.request.get('/api/cctv?region=oceania', { timeout: 60_000 });
  for (let i = 0; i < 6 && res.status() === 503 && ((await res.json()) as { pendingRegions?: string[] }).pendingRegions?.includes('oceania'); i++) {
    await page.waitForTimeout(10_000);
    res = await page.request.get('/api/cctv?region=oceania', { timeout: 60_000 });
  }
  if (res.status() === 503) return null;
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { fields: string[]; rows: Row[] };
  const f = (k: string) => body.fields.indexOf(k);
  return body.rows
    .filter((r) => r[f('providerId')] === 'nsw' && r[f('stillUrl')] && r[f('streamType')] === 'jpg')
    .map((r) => ({ id: String(r[f('id')]), lat: Number(r[f('lat')]), lng: Number(r[f('lng')]) }));
}

/** Images inside `selector` that finished loading without decoding (a broken-image icon). */
async function brokenImages(page: Page, selector: string): Promise<number> {
  return page.evaluate((sel) => [...document.querySelectorAll(`${sel} img`)].filter((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth === 0).length, selector);
}

test.describe('camera frames: operator outages are never broken images', () => {
  test('stills proxy refuses an HTML frame as JSON SOURCE OFFLINE and the provider reads FRAMES UNAVAILABLE', async ({ page }) => {
    const cams = await nswCameras(page);
    test.skip(cams === null || cams.length < 5, 'NSW camera list unavailable right now (asserted SOURCE OFFLINE elsewhere)');
    let outage = 0;
    for (const c of cams!.slice(0, 5)) {
      const res = await page.request.get(`/api/cctv/proxy?id=${encodeURIComponent(c.id)}`, { timeout: 30_000 });
      const type = res.headers()['content-type'] ?? '';
      expect(type.startsWith('text/html'), 'an operator HTML page is never relayed').toBe(false);
      if (res.status() === 200) {
        expect(type).toMatch(/^image\//);
        expect(res.headers()['x-frame-fetched-at']).toMatch(/Z$/);
        expect(['operator', 'last-modified', 'none']).toContain(res.headers()['x-frame-time-source']);
        continue;
      }
      const b = await res.json();
      expect(b.error).toBe('frame_unavailable');
      expect(['offline', 'unavailable']).toContain(b.state);
      if (b.detail === 'not_an_image') {
        outage++;
        expect(b).toMatchObject({ state: 'offline', upstreamType: 'text/html' });
      }
    }
    test.skip(outage < 5, 'NSW is serving images again: the outage path is covered by the unit tests');
    const p = await (await page.request.get('/api/cctv/providers')).json();
    expect(p.frames.nsw.state).toBe('unavailable');
    expect(p.frames.nsw.cameras).toBeGreaterThanOrEqual(5);
    expect(p.frames.nsw.errors.not_an_image).toBeGreaterThanOrEqual(5);
  });

  test('preview tiles and the viewer show placeholders, not broken images', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'desktop preview tiles');
    test.setTimeout(150_000);
    const cams = await nswCameras(page);
    test.skip(cams === null || cams.length === 0, 'NSW camera list unavailable right now');
    const c = cams![0]!;
    await page.goto(`/?c=${c.lat.toFixed(5)},${c.lng.toFixed(5)},14&layers=cctv,cctv_previews`);
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });
    const tiles = page.getByTestId('cctv-previews');
    await expect(tiles).toBeVisible({ timeout: 60_000 });
    // Every tile settles to a decoded frame or a labelled placeholder; a broken image never stays.
    await expect
      .poll(
        async () =>
          page.evaluate(() =>
            [...document.querySelectorAll('[data-testid="cctv-previews"] button')].every((b) => {
              const img = b.querySelector('img');
              if (!img) return !!b.querySelector('[data-testid="cctv-tile-unavailable"]') || !!b.querySelector('video');
              return img.complete && img.naturalWidth > 0;
            }),
          ),
        { timeout: 45_000 },
      )
      .toBe(true);
    expect(await brokenImages(page, '[data-testid="cctv-previews"]')).toBe(0);
    // A placeholder names its reason; SOURCE OFFLINE always carries a last-good time (or says there is none).
    for (const note of await page.getByTestId('cctv-tile-unavailable').all()) {
      const text = (await note.textContent()) ?? '';
      if (text.includes('SOURCE OFFLINE')) expect(text).toMatch(/LAST GOOD \d{2}:\d{2}Z|NO FRAME IN \d+ MIN/);
      else expect(text).toMatch(/CAMERA OFFLINE|FEED UNAVAILABLE/);
    }

    await tiles.getByRole('button').first().click();
    const card = page.getByTestId('camera-card');
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.getByTestId('camera-open-viewer').click();
    const viewer = page.getByTestId('camera-viewer');
    await expect(viewer).toBeVisible({ timeout: 15_000 });
    const frame = viewer.getByTestId('viewer-frame');
    const offline = viewer.getByTestId('viewer-unavailable');
    await expect(frame.or(offline)).toBeVisible({ timeout: 45_000 });
    if (await offline.isVisible()) {
      await expect(offline).toContainText(/CAMERA OFFLINE|FEED UNAVAILABLE/);
      await expect(offline.getByRole('button', { name: /retry/i })).toBeVisible();
      expect(await viewer.locator('img').count()).toBe(0);
    } else {
      // A frame on screen: its own time (or UNTIMED) and the fetch time, never LIVE.
      await expect(viewer.getByTestId('viewer-fetched')).toBeVisible();
      await expect(viewer.getByTestId('viewer-age')).not.toContainText('LIVE');
    }
    expect(await brokenImages(page, '[data-testid="camera-viewer"]')).toBe(0);
  });
});
