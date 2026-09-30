import zlib from 'node:zlib';
import type * as Http from '@/lib/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FX, type Route } from '@/features/hazards/server/__fixtures__';
import { freshCache, req, resetCache } from '@/features/hazards/server/__fixtures__/routes';
import { firesFeed } from '@/features/hazards/server/firms';
import { FIRE_FIELDS, FiresResponse } from '@/lib/schemas';
import { GET } from './route';

const state = vi.hoisted(() => ({ routes: [] as Route[] }));
vi.mock('@/lib/http', async (importOriginal) => {
  const orig = await importOriginal<typeof Http>();
  const { httpMock } = await import('@/features/hazards/server/__fixtures__');
  return { ...orig, ...httpMock(() => state.routes, orig.HttpError) };
});

const G = globalThis as unknown as { __godseyeFirmsFiles?: Map<string, unknown> };

beforeEach(() => {
  freshCache();
  G.__godseyeFirmsFiles?.clear();
});
afterEach(() => {
  firesFeed.stop();
  resetCache();
});

const ALL: Route[] = [
  ['SUOMI_VIIRS_C2_Global_24h.csv', FX.snpp],
  ['J1_VIIRS_C2_Global_24h.csv', FX.j1],
  ['J2_VIIRS_C2_Global_24h.csv', FX.j2],
  ['MODIS_C6_1_Global_24h.csv', FX.modis],
  ['eonet.gsfc.nasa.gov/api/v3/events', FX.eonet],
];

describe('GET /api/fires', () => {
  it('serves FIRE_FIELDS columnar rows ranked by FRP with totals, sampling rule and EONET wildfires', async () => {
    state.routes = ALL;
    const res = await GET(req('/api/fires'), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    const parsed = FiresResponse.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(body.fields).toEqual([...FIRE_FIELDS]);
    expect(body.totalDetections).toBe(600);
    expect(body.rows).toHaveLength(600);
    expect(body.sampling).toMatch(/fire radiative power.*never by stride/);
    expect(body.perSatellite).toEqual({ SNPP: 150, NOAA20: 150, NOAA21: 150, MODIS: 150 });
    const frp = body.rows.map((r: unknown[]) => (r[3] as number | null) ?? -1);
    expect(frp).toEqual([...frp].sort((a: number, b: number) => b - a));
    expect(body.rows.every((r: unknown[]) => typeof r[8] === 'number' && (r[8] as number) > 1.7e9)).toBe(true);
    expect(body.wildfireEvents.length).toBeGreaterThan(0);
    expect(body.meta).toMatchObject({ feed: 'fires', kind: 'live', state: 'live' });
    expect(Object.keys(body.providers).sort()).toEqual(['eonet', 'firms_modis', 'firms_viirs_noaa20', 'firms_viirs_noaa21', 'firms_viirs_snpp']);
    expect(body.providers.firms_viirs_snpp).toMatchObject({ ok: true, count: 150 });
  });

  it('negotiates brotli and answers If-None-Match with 304', async () => {
    state.routes = ALL;
    const res = await GET(req('/api/fires', { 'accept-encoding': 'gzip, br' }), undefined);
    expect(res.headers.get('content-encoding')).toBe('br');
    const raw = zlib.brotliDecompressSync(Buffer.from(await res.arrayBuffer()));
    expect(JSON.parse(raw.toString('utf8')).rows).toHaveLength(600);
    const again = await GET(req('/api/fires', { 'if-none-match': res.headers.get('etag')! }), undefined);
    expect(again.status).toBe(304);
  });

  it('keeps serving when one satellite file fails and reports it', async () => {
    state.routes = ALL.map(([k, v]) => [k, k.startsWith('J2') ? 503 : v]);
    const body = await (await GET(req('/api/fires'), undefined)).json();
    expect(body.totalDetections).toBe(450);
    expect(body.providers.firms_viirs_noaa21).toMatchObject({ ok: false, error: 'http_503', count: 0 });
  });

  it('is SOURCE OFFLINE (503) when no FIRMS file loads, even if EONET answers', async () => {
    state.routes = [['eonet.gsfc.nasa.gov', FX.eonet]];
    const res = await GET(req('/api/fires'), undefined);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('source_offline');
    expect(body.providers.firms_viirs_snpp.ok).toBe(false);
  });
});
