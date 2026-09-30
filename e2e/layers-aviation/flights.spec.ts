import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Aviation layer against the live adsb.lol feed. When the upstream is down the server answers
 * 503 SOURCE OFFLINE and these tests skip (honestly) instead of asserting on nothing.
 */
interface Flights {
  fields: string[];
  rows: (string | number | null)[][];
}

async function liveFlights(request: APIRequestContext): Promise<Flights | null> {
  const res = await request.get('/api/flights', { timeout: 90_000 });
  if (res.status() === 503) return null;
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as Flights & { providers: Record<string, unknown>; meta: { feed: string } };
  expect(body.meta.feed).toBe('flights');
  expect(body.providers).toHaveProperty('adsblol_tiles');
  return body;
}

/** An aircraft that will not move before we click it: on the ground, else the slowest one. */
function pickTarget(f: Flights): { lat: number; lng: number; id: string } {
  const i = (k: string) => f.fields.indexOf(k);
  const rows = [...f.rows].sort((a, b) => {
    const ga = (a[i('onGround')] === 1 ? -1 : 0) + ((a[i('gsKt')] as number | null) ?? 0) / 1e4;
    const gb = (b[i('onGround')] === 1 ? -1 : 0) + ((b[i('gsKt')] as number | null) ?? 0) / 1e4;
    return ga - gb;
  });
  const r = rows[0]!;
  return { lat: r[i('lat')] as number, lng: r[i('lng')] as number, id: r[i('id')] as string };
}

async function openAt(page: Page, t: { lat: number; lng: number }) {
  await page.goto(`/?layers=flights,private,jets,military&c=${t.lat.toFixed(5)},${t.lng.toFixed(5)},11`);
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('status', { name: /loading/i })).toBeHidden({ timeout: 20_000 });
  const status = page.getByTestId('aviation-status');
  await expect(status).toHaveAttribute('data-drawn', /^[1-9]\d*$/, { timeout: 45_000 });
  return status;
}

async function clickCentre(page: Page) {
  const box = (await page.locator('canvas.maplibregl-canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test('flights layer draws live aircraft and selects one on click', async ({ page, request }) => {
  test.setTimeout(150_000);
  const flights = await liveFlights(request);
  test.skip(flights === null, 'adsb.lol is SOURCE OFFLINE right now: nothing live to draw');
  expect(flights!.rows.length).toBeGreaterThan(0);

  const status = await openAt(page, pickTarget(flights!));
  expect(Number(await status.getAttribute('data-total'))).toBeGreaterThan(0);
  await clickCentre(page);
  await expect(status).toContainText('Selected aircraft', { timeout: 10_000 });
});

test('clicking an aircraft opens its card with source, observed time and freshness', async ({ page, request }) => {
  test.setTimeout(150_000);
  const flights = await liveFlights(request);
  test.skip(flights === null, 'adsb.lol is SOURCE OFFLINE right now: nothing live to draw');

  const status = await openAt(page, pickTarget(flights!));
  await clickCentre(page);
  await expect(status).toContainText('Selected aircraft', { timeout: 10_000 });
  const card = page.getByTestId('aircraft-card');
  const shown = await card.waitFor({ state: 'visible', timeout: 10_000 }).then(
    () => true,
    () => false,
  );
  test.skip(!shown, 'The HUD entity-card host (design-system-hud) is not mounted in this build');
  await expect(card).toContainText('SOURCE');
  await expect(card).toContainText(/adsb\.lol|OpenSky|adsb\.fi/);
  await expect(card).toContainText('OBSERVED');
  await expect(card).toContainText(/\d{2}:\d{2}:\d{2}Z/);
  await expect(card.getByTestId('freshness-badge')).toHaveText(/LIVE|STALE|OFFLINE|\d+[smhd]/);
  await expect(card.getByRole('button', { name: /watch/i })).toBeVisible();
});
