import { expect, test, type Page } from '@playwright/test';
import { openMap } from './helpers';

/**
 * Weather alert areas (r10): NWS zone outlines arrive once in the response's `zones` map and alerts
 * reference them by `zoneRefs`. The body stays under the 4 MB cap, every reference resolves, and on
 * the map a zone alert's shaded area is still drawn and pickable (clicking inside the zone, away
 * from the marker, opens the alert's card, which lists its zones). Runs against the live
 * /api/weather; SOURCE OFFLINE or a day without zone-placed NWS alerts skips (asserted).
 */

interface Alert {
  id: string;
  lat: number;
  lng: number;
  title: string;
  provider: string;
  positionBasis?: string;
  geometry: unknown;
  zones?: string[];
  zoneRefs?: string[];
}

interface Body {
  items: Alert[];
  zones?: Record<string, { type: string }>;
}

async function liveWeather(page: Page): Promise<{ body: Body; bytes: number } | null> {
  const res = await page.request.get('/api/weather', { timeout: 120_000 });
  const text = await res.text();
  const body = JSON.parse(text);
  if (res.status() === 503) {
    expect(body.error).toBe('source_offline');
    return null;
  }
  expect(res.ok()).toBe(true);
  expect(body.meta.feed).toBe('weather');
  return { body, bytes: Buffer.byteLength(text) };
}

test.describe('weather alert areas', () => {
  test.beforeEach(() => test.setTimeout(240_000));

  test('zone outlines are shared, every reference resolves and the body is under 4 MB', async ({ page }) => {
    const live = await liveWeather(page);
    test.skip(live === null, 'weather feed offline right now: /api/weather answered SOURCE OFFLINE (asserted)');
    const { body, bytes } = live!;
    expect(bytes).toBeLessThan(4 * 1024 * 1024);
    const zones = body.zones ?? {};
    const used = new Set<string>();
    for (const e of body.items.filter((i) => i.positionBasis === 'zone-centroid')) {
      expect(e.zoneRefs?.length, `${e.id} has zone refs`).toBeGreaterThan(0);
      for (const k of e.zoneRefs!) {
        expect(zones[k]?.type, `${e.id} → ${k}`).toMatch(/^(Multi)?Polygon$/);
        used.add(k);
      }
    }
    // Each outline is sent once and only when an alert uses it.
    expect(Object.keys(zones).sort()).toEqual([...used].sort());
  });

  test('a zone alert area is drawn and clicking inside it opens the card with its zones', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'desktop pointer test');
    const live = await liveWeather(page);
    test.skip(live === null, 'weather feed offline right now: /api/weather answered SOURCE OFFLINE (asserted)');
    const items = live!.body.items;
    // An alert whose marker has no other event within 1° (so the click can only mean this alert).
    const target = items.find((e) => e.positionBasis === 'zone-centroid' && e.zones?.length && !items.some((o) => o !== e && Math.hypot(o.lat - e.lat, o.lng - e.lng) < 1));
    test.skip(!target, 'no isolated zone-placed NWS alert right now (asserted from /api/weather)');
    await openMap(page, `c=${target!.lat.toFixed(4)},${target!.lng.toFixed(4)},9&layers=weather`);
    await page.waitForTimeout(3000);
    const vp = page.viewportSize()!;
    const card = page.getByTestId('hazard-card').filter({ visible: true }).first();
    // UGC codes of the target's zones (`fire/CAZ211` → `CAZ211`), as the card's Zones row lists them.
    const codes = (target!.zoneRefs ?? target!.zones!).map((k) => k.split('/').pop()!);
    const zonesRow = card.locator('dt', { hasText: /^Zones$/ }).locator('xpath=following-sibling::dd[1]');
    // Off the marker (its hit radius is ≤ ~22 px) but within ~10 km of the zone centroid.
    let opened = false;
    for (const [dx, dy] of [[0, 40], [40, 0], [0, -40], [-40, 0]] as const) {
      await page.mouse.click(vp.width / 2 + dx, vp.height / 2 + dy);
      opened = await card.waitFor({ state: 'visible', timeout: 8000 }).then(
        () => true,
        () => false,
      );
      // Overlapping alerts can share the zone (e.g. two Small Craft Advisories on PKZ642/643): any
      // card whose Zones row lists one of the target's zones proves the area pick.
      const zonesText = opened ? ((await zonesRow.textContent({ timeout: 2_000 }).catch(() => null)) ?? '') : '';
      if (opened && codes.some((c) => zonesText.includes(c))) break;
      opened = false;
      await page.keyboard.press('Escape');
    }
    expect(opened, 'clicking inside the zone area opened the alert card').toBe(true);
    await expect(zonesRow).toHaveText(new RegExp(codes.map((c) => c.replace(/[^\w]/g, '')).join('|')));
  });
});
