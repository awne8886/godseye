import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as HttpModule from '@/lib/http';
import type * as RateLimitModule from '@/lib/ratelimit';
import { DirectionsResponse } from '@/lib/schemas';
import { fixture, upstream } from '@/components/panels/recon/__fixtures__/mock-http';
import { error, freshState, get } from '@/components/panels/recon/__fixtures__/route-helpers';
import { SNAP_LIMIT_M, decodePolyline, elevationProfile, osrmInstruction, snapGap, unreachableDetail, valhallaRequest } from '@/components/panels/recon/server/directions';

// Fixtures: Valhalla /route (auto, Berlin, 2 alternates), /height, OSRM driving (Berlin), 2026-09-30;
// OSRM driving Berlin → New York (overview=simplified) and Valhalla error 154 for the same pair, 2026-09-30.
vi.mock('@/lib/http', async (orig) => (await import('@/components/panels/recon/__fixtures__/mock-http')).mockHttp(await orig<typeof HttpModule>()));
vi.mock('@/lib/ratelimit', async (orig) => ({ ...(await orig<typeof RateLimitModule>()), providerBucket: () => ({ take: async () => undefined }) }));

const { GET } = await import('./route');
const call = (qs: string) => get(GET, `http://localhost/api/directions${qs}`);
const BERLIN = '?from=52.52,13.38&to=52.50,13.42';

async function valid(res: Response) {
  expect(res.status, await res.clone().text()).toBe(200);
  const body = await res.json();
  const p = DirectionsResponse.safeParse(body);
  expect(p.success, JSON.stringify(p.error?.issues.slice(0, 3))).toBe(true);
  return body;
}

describe('GET /api/directions', () => {
  beforeEach(() => freshState());

  it('normalises Valhalla (primary + alternates) to DirectionsResponse', async () => {
    upstream.on('valhalla1.openstreetmap.de/route', { json: fixture('valhalla-auto-berlin.json') });
    const body = await valid(await call(BERLIN));
    expect(body.engine).toBe('valhalla');
    expect(body.mode).toBe('drive');
    expect(body.routes.length).toBe(3);
    const r = body.routes[0];
    expect(r.distanceM).toBe(4321);
    expect(r.durationS).toBe(703);
    expect(r.geometry.coordinates[0][0]).toBeCloseTo(13.38, 2);
    expect(r.geometry.coordinates[0][1]).toBeCloseTo(52.52, 2);
    expect(r.steps[0]).toMatchObject({ instruction: 'Drive east.', maneuver: 'depart', startIndex: 0 });
    expect(r).toMatchObject({ hasToll: false, hasHighway: false, hasFerry: false });
    expect(body.elevation).toBeNull();
    expect(body.providers.valhalla.ok).toBe(true);
    const sent = JSON.parse(upstream.calls[0]!.body!);
    expect(sent).toMatchObject({ costing: 'auto', alternates: 2, locations: [{ lat: 52.52, lon: 13.38 }, { lat: 52.5, lon: 13.42 }] });
  });

  it('maps OSIRIS mode aliases and adds an elevation profile on foot', async () => {
    upstream.on('valhalla1.openstreetmap.de/route', { json: fixture('valhalla-auto-berlin.json') });
    upstream.on('valhalla1.openstreetmap.de/height', { json: fixture('valhalla-height.json') });
    for (const [alias, mode, costing] of [['pedestrian', 'walk', 'pedestrian'], ['bicycle', 'bike', 'bicycle'], ['auto', 'drive', 'auto'], ['walk', 'walk', 'pedestrian']] as const) {
      freshState();
      upstream.on('valhalla1.openstreetmap.de/route', { json: fixture('valhalla-auto-berlin.json') });
      upstream.on('valhalla1.openstreetmap.de/height', { json: fixture('valhalla-height.json') });
      const body = await valid(await call(`${BERLIN}&mode=${alias}`));
      expect(body.mode).toBe(mode);
      expect(JSON.parse(upstream.calls[0]!.body!).costing).toBe(costing);
      if (mode !== 'drive') expect(body).toMatchObject({ ascentM: 22, descentM: 0 });
    }
  });

  it('passes via points and avoid options to Valhalla', async () => {
    upstream.on('valhalla1.openstreetmap.de/route', { json: fixture('valhalla-auto-berlin.json') });
    await valid(await call(`${BERLIN}&via=52.51,13.40|52.505,13.41&avoid=tolls,ferries`));
    const sent = JSON.parse(upstream.calls[0]!.body!);
    expect(sent.locations).toHaveLength(4);
    expect(sent.locations[1]).toMatchObject({ type: 'through' });
    expect(sent.alternates).toBeUndefined();
    expect(sent.costing_options).toEqual({ auto: { use_tolls: 0, use_ferry: 0 } });
  });

  it('falls back to OSRM and phrases its maneuvers', async () => {
    upstream.on('valhalla1', { status: 502 });
    upstream.on('router.project-osrm.org/route/v1/driving/', { json: fixture('osrm-driving-berlin.json') });
    const body = await valid(await call(BERLIN));
    expect(body.engine).toBe('osrm');
    expect(body.providers.valhalla).toMatchObject({ ok: false, error: 'http_502' });
    expect(body.providers.osrm.ok).toBe(true);
    expect(body.routes[0].steps[0].instruction).toMatch(/^(Head|Depart)/);
    expect(body.routes[0].steps.some((s: { instruction: string }) => /^Turn (left|right) onto /.test(s.instruction))).toBe(true);
    expect(body.routes[0].steps.at(-1).instruction).toBe('Arrive at your destination');
  });

  it('uses the FOSSGIS foot/bike OSRM profiles for walk/bike fallback', async () => {
    upstream.on('valhalla1', { error: 'timeout' });
    upstream.on('routing.openstreetmap.de/routed-foot/', { json: fixture('osrm-driving-berlin.json') });
    const body = await valid(await call(`${BERLIN}&mode=walk`));
    expect(body.engine).toBe('osrm');
    expect(upstream.calls.some((c) => c.url.startsWith('https://routing.openstreetmap.de/routed-foot/route/v1/driving/13.380000,52.520000;13.420000,52.500000'))).toBe(true);
  });

  it('answers 503 with both engines listed when no engine answers', async () => {
    upstream.on('valhalla1', { status: 400 });
    upstream.on('router.project-osrm.org', { status: 502 });
    const body = await error(await call(BERLIN), 503);
    expect(Object.keys(body.providers)).toEqual(['valhalla', 'osrm']);
  });

  it('answers 422 no_route when OSRM says NoRoute', async () => {
    upstream.on('valhalla1', { status: 400 });
    upstream.on('router.project-osrm.org', { json: { code: 'NoRoute', message: 'Impossible route between points', routes: [] } });
    const body = await error(await call(BERLIN), 422);
    expect(body.error).toBe('no_route');
    expect(body.unreachable).toMatchObject({ role: 'destination', distanceM: null });
    expect(Object.keys(body.providers)).toEqual(['valhalla', 'osrm']);
  });

  // R4-M1 (was r4-snap.repro.test.ts): live on 2026-09-30 Valhalla refused (error 154, > 1,500 km) and
  // OSRM "routed" Berlin → New York to Cabo da Roca, snapping the destination 5,534,234 m away.
  it('R4-M1: Berlin → New York is refused as no_route, not routed to Portugal', async () => {
    upstream.on('valhalla1.openstreetmap.de/route', { status: 400, json: fixture('valhalla-error-154-berlin-newyork.json') });
    upstream.on('router.project-osrm.org/route/v1/driving/13.380000,52.520000;-74.000000,40.700000', { json: fixture('osrm-driving-berlin-newyork.json') });
    const res = await call('?from=52.52,13.38&to=40.7,-74');
    const body = await error(res, 422);
    expect(body).toMatchObject({ error: 'no_route', unreachable: { index: 1, role: 'destination' } });
    expect(body.unreachable.distanceM).toBeGreaterThan(5_000_000);
    expect(body.detail).toMatch(/No road route between these points: .* 5,534 km from the destination/);
    expect(body.routes).toBeUndefined();
    expect(body.providers.valhalla).toMatchObject({ ok: false, error: 'http_400' });
    expect(body.providers.osrm.ok).toBe(true);
  });

  it('refuses a Valhalla route whose end is far from the requested destination and asks OSRM', async () => {
    // Valhalla's Berlin trip ends at 52.50,13.42; ask for a destination ~11 km east of that.
    upstream.on('valhalla1.openstreetmap.de/route', { json: fixture('valhalla-auto-berlin.json') });
    upstream.on('router.project-osrm.org', { json: { code: 'NoRoute', routes: [] } });
    const body = await error(await call('?from=52.52,13.38&to=52.50,13.58'), 422);
    expect(body.unreachable.role).toBe('destination');
    expect(body.unreachable.distanceM).toBeGreaterThan(SNAP_LIMIT_M);
  });

  it('validates points, modes and via count', async () => {
    for (const qs of ['?from=52.5&to=52.5,13.4', '?from=91,0&to=0,0', `${BERLIN}&mode=plane`, `${BERLIN}&via=${Array(9).fill('1,1').join('|')}`, `${BERLIN}&via=abc`]) await error(await call(qs), 400);
    expect(upstream.calls).toEqual([]);
  });
});

describe('directions helpers', () => {
  it('decodes precision-6 and precision-5 polylines', () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5)).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ]);
    expect(decodePolyline('', 6)).toEqual([]);
  });

  it('builds avoid options as Valhalla preferences', () => {
    expect(valhallaRequest([{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }], 'bike', { tolls: false, highways: true, ferries: false }).costing_options).toEqual({ bicycle: { use_highways: 0 } });
  });

  it('snapGap accepts a route that reaches every point and names the worst one otherwise', () => {
    const route = { distanceM: 1, durationS: 1, geometry: { type: 'LineString' as const, coordinates: [[13.38, 52.52], [13.40, 52.51], [13.42, 52.5]] }, steps: [], hasToll: false, hasHighway: false, hasFerry: false };
    const pts = [{ lat: 52.52, lng: 13.38 }, { lat: 52.51, lng: 13.4 }, { lat: 52.5, lng: 13.42 }];
    expect(snapGap(pts, route)).toBeNull();
    expect(snapGap(pts, route, [4.8, null, 30])).toBeNull();
    expect(snapGap(pts, route, [4.8, null, 5_534_234])).toEqual({ index: 2, role: 'destination', distanceM: 5_534_234 });
    expect(snapGap([pts[0]!, { lat: 52.8, lng: 13.4 }, pts[2]!], route)).toMatchObject({ index: 1, role: 'via' });
    expect(snapGap([{ lat: 53, lng: 13.38 }, pts[2]!], route)).toMatchObject({ index: 0, role: 'start' });
    expect(unreachableDetail({ index: 1, role: 'via', distanceM: 6200 })).toContain('6.2 km from via point 1');
  });

  it('computes ascent and descent', () => {
    expect(elevationProfile([[0, 10], [100, 30], [200, 20], [300, 25]])).toMatchObject({ ascentM: 25, descentM: 10 });
    expect(elevationProfile([[0, 10]])).toBeNull();
  });

  it('phrases OSRM steps', () => {
    expect(osrmInstruction({ maneuver: { type: 'roundabout', exit: 2 }, name: 'A1' })).toBe('At the roundabout, take exit 2 onto A1');
    expect(osrmInstruction({ maneuver: { type: 'turn', modifier: 'left' }, name: '' })).toBe('Turn left');
  });
});
