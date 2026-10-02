/**
 * perf m-g: with the default layers (maritime is on), the browser must not re-poll the maritime
 * REFERENCE answer. Keyless (`aisConfigured: false`) the route is fetched once and refreshed on an
 * hours-long TTL, so a 60 s window after the first answer sees no further request; a server that
 * relays AIS is polled at the registry cadence (10 s, so at most 6 a minute). Measured on the
 * real page with the real route.
 */
import { expect, test, type Request } from '@playwright/test';
import { gotoMap } from '../map-engine/helpers';

test('maritime polls only a keyed AIS relay; the keyless REFERENCE answer is fetched once', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'request cadence is viewport-independent');
  test.setTimeout(240_000);
  const seen: number[] = [];
  page.on('request', (r: Request) => {
    if (new URL(r.url()).pathname === '/api/maritime') seen.push(Date.now());
  });
  const first = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/maritime', { timeout: 150_000 });
  await gotoMap(page);
  const res = await first;
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { aisConfigured: boolean; ports: unknown[]; chokepoints: unknown[] };
  expect(body.ports.length).toBeGreaterThan(0);
  expect(body.chokepoints.length).toBeGreaterThan(0);
  const start = Date.now();
  await page.waitForTimeout(60_000);
  const inWindow = seen.filter((t) => t > start).length;
  if (body.aisConfigured) expect(inWindow).toBeLessThanOrEqual(6);
  else expect(inWindow).toBe(0);
  // One page, one requester: the load itself fetched it once.
  expect(seen.filter((t) => t <= start)).toHaveLength(1);
});

test('a keyed AIS relay is polled at the registry cadence by a single requester (≤ 6 a minute)', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'request cadence is viewport-independent');
  test.setTimeout(240_000);
  // The sandbox has no AIS key: answer with the real route's body, `aisConfigured` set, to drive
  // the client's keyed schedule (the server-side relay itself is covered by unit tests).
  const seen: number[] = [];
  await page.route('**/api/maritime', async (route) => {
    seen.push(Date.now());
    const real = await route.fetch();
    const body = { ...(await real.json()), aisConfigured: true };
    await route.fulfill({ status: real.status(), contentType: 'application/json', body: JSON.stringify(body) });
  });
  await gotoMap(page);
  await expect.poll(() => seen.length, { timeout: 150_000 }).toBeGreaterThan(0);
  const start = Date.now();
  await page.waitForTimeout(60_000);
  const inWindow = seen.filter((t) => t > start).length;
  expect(inWindow).toBeGreaterThanOrEqual(4);
  expect(inWindow).toBeLessThanOrEqual(6);
});
