import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStore, clearL1, setStore } from '@/lib/cache';
import { resetFeeds } from '@/lib/feeds';
import { httpJson } from '@/lib/http';
import { SpaceWeatherResponse } from '@/lib/schemas';
import { netError, swpcRoutes, upstreamRouter } from '@/features/space/__fixtures__/upstreams';
import { GET } from './route';

vi.mock('@/lib/http', async (orig) => ({ ...(await orig<Record<string, unknown>>()), httpJson: vi.fn() }));

const req = () => new Request('http://localhost/api/space-weather', { headers: { 'x-forwarded-for': '10.1.2.5' } });

beforeEach(() => {
  clearL1();
  resetFeeds();
  setStore(new MemoryStore());
  vi.mocked(httpJson).mockReset();
});
afterEach(() => {
  resetFeeds();
  setStore(undefined);
});

describe('GET /api/space-weather', () => {
  it('assembles Kp, scales, X-ray, RTSW solar wind and alerts with meta + providers', async () => {
    vi.mocked(httpJson).mockImplementation(upstreamRouter(swpcRoutes()).impl as never);
    const res = await GET(req(), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    const parsed = SpaceWeatherResponse.safeParse(body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues?.slice(0, 3))).toBe(true);
    expect(body.kp).toMatchObject({ kp: 0.33, observedAt: '2026-09-30T15:00:00.000Z', stormLevel: 'Quiet' });
    expect(body.scales).toEqual({ R: 0, S: 0, G: 0 });
    expect(body.xray.class).toBe('B2.8');
    expect(body.solarWind.source).toContain('SOLAR1');
    expect(body.alerts.length).toBeGreaterThan(0);
    expect(body.plasma).toBeUndefined(); // internal state is not served
    expect(body.meta).toMatchObject({ feed: 'space-weather', kind: 'live' });
    expect(Object.keys(body.providers).sort()).toEqual(['swpc-alerts', 'swpc-kp', 'swpc-rtsw-mag', 'swpc-rtsw-wind', 'swpc-scales', 'swpc-xrays']);
    expect(Object.values(body.providers).every((p) => (p as { ok: boolean }).ok)).toBe(true);
  });

  it('a failed Kp fetch is Unknown, never Quiet', async () => {
    const routes = swpcRoutes();
    routes['noaa-planetary-k-index.json'] = netError('https://services.swpc.noaa.gov/');
    vi.mocked(httpJson).mockImplementation(upstreamRouter(routes).impl as never);
    const body = await (await GET(req(), undefined)).json();
    expect(SpaceWeatherResponse.safeParse(body).success).toBe(true);
    expect(body.kp).toMatchObject({ kp: null, stormLevel: 'Unknown' });
    expect(body.providers['swpc-kp'].ok).toBe(false);
    expect(body.solarWind.speedKmS).not.toBeNull();
  });

  it('no alerts right now is a truthful empty list', async () => {
    const routes = swpcRoutes();
    routes['products/alerts.json'] = [];
    vi.mocked(httpJson).mockImplementation(upstreamRouter(routes).impl as never);
    const body = await (await GET(req(), undefined)).json();
    expect(body.alerts).toEqual([]);
    expect(body.providers['swpc-alerts']).toMatchObject({ ok: true, count: 0 });
  });

  it('503 SOURCE OFFLINE when every SWPC provider fails', async () => {
    vi.mocked(httpJson).mockImplementation(upstreamRouter({}).impl as never);
    const res = await GET(req(), undefined);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('source_offline');
    expect(body.meta.state).toBe('offline');
  });
});
