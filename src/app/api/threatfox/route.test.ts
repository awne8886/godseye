import type * as Http from '@/lib/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FX, type Call, type Route } from '@/features/threats/server/__fixtures__';
import { freshCache, req, resetCache } from '@/features/threats/server/__fixtures__/routes';
import { threatFoxFeed } from '@/features/network/server/abusech';
import { resetIpGeo } from '@/features/network/server/ipgeo';
import { ThreatFoxResponse } from '@/lib/schemas';
import { GET } from './route';

const state = vi.hoisted(() => ({ routes: [] as Route[], calls: [] as Call[] }));
vi.mock('@/lib/http', async (importOriginal) => {
  const orig = await importOriginal<typeof Http>();
  const { httpMock } = await import('@/features/threats/server/__fixtures__');
  return { ...orig, ...httpMock(() => state.routes, orig.HttpError, state.calls) };
});

const ipapi = (_url: string, opts: { body?: string | Buffer }) =>
  Buffer.from(JSON.stringify((JSON.parse(String(opts.body)) as string[]).map((q) => ({ status: 'success', query: q, country: 'Testland', city: 'Town', lat: 1, lon: 2 }))));

beforeEach(() => {
  freshCache();
  resetIpGeo();
  state.calls.length = 0;
});
afterEach(() => {
  threatFoxFeed.stop();
  resetCache();
});

describe('GET /api/threatfox', () => {
  it('lists every IOC as an INDICATOR and places only IP IOCs', async () => {
    state.routes = [['threatfox.abuse.ch/export/json/recent', FX.threatfox], ['ip-api.com/batch', ipapi]];
    const res = await GET(req('/api/threatfox'), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(ThreatFoxResponse.safeParse(body).success).toBe(true);
    expect(body.items.every((i: { label: string }) => i.label === 'INDICATOR')).toBe(true);
    expect(body.located).toBe(body.items.filter((i: { geo: unknown }) => i.geo).length);
    expect(body.items.filter((i: { geo: unknown; iocType: string }) => i.geo && i.iocType !== 'ip:port')).toHaveLength(0);
    expect(body.providers.threatfox.ok).toBe(true);
    expect(body.meta.feed).toBe('threatfox');
    const looked = state.calls.filter((c) => c.url.includes('ip-api')).flatMap((c) => JSON.parse(c.body!) as string[]);
    expect(looked.every((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip))).toBe(true);
  });
});
