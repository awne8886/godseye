import type * as Ssrf from '@/lib/ssrf';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FX, text } from '@/features/surveillance/server/__fixtures__';
import { done, fresh, jpeg, req } from '@/features/surveillance/server/__fixtures__/helpers';

const state = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock('@/features/surveillance/server/loaders', async () => {
  const { fixtureLoaders } = await import('@/features/surveillance/server/__fixtures__/loaders');
  return { LOADERS: fixtureLoaders() };
});
vi.mock('@/lib/ssrf', async (orig) => {
  const real = await orig<typeof Ssrf>();
  const { FX: fx, text: t } = await import('@/features/surveillance/server/__fixtures__');
  return {
    ...real,
    allowListedFetch: async (url: string, rules: Parameters<typeof real.matchesAllowList>[1]) => {
      state.calls.push(url);
      if (!real.matchesAllowList(new URL(url), rules)) throw Object.assign(new Error('blocked'), { code: 'blocked' });
      return { status: 200, ok: true, notModified: false, headers: { 'content-type': 'application/json' }, body: Buffer.from(t(fx.txdotSnapshot)), url, etag: null, lastModified: null, ms: 1, attempts: 1 };
    },
  };
});

const { GET } = await import('./route');

beforeEach(() => {
  fresh();
  state.calls = [];
});
afterEach(done);

describe('GET /api/cctv/texas/snapshot', () => {
  it('decodes the TxDOT base64 JPEG and reports the frame time in UTC', async () => {
    const id = encodeURIComponent('txdot-AUS-FM-734 @ US-290 EB');
    const res = await GET(req(`/api/cctv/texas/snapshot?id=${id}`), undefined);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('x-frame-observed-at')).toBe('2026-09-30T20:02:00.000Z');
    expect(res.headers.get('cache-control')).toBe('public, max-age=30, s-maxage=30');
    expect(Buffer.from(await res.arrayBuffer()).equals(jpeg())).toBe(true);
    expect(state.calls[0]).toContain('https://its.txdot.gov/its/DistrictIts/GetCctvSnapshotByIcdId?districtCode=AUS&icdId=');
    expect(text(FX.txdotSnapshot).length).toBeGreaterThan(1000);
  });

  it('validates the id shape and catalogue membership', async () => {
    expect((await GET(req('/api/cctv/texas/snapshot?id=hktd-H429F'), undefined)).status).toBe(400);
    expect((await GET(req('/api/cctv/texas/snapshot?id=txdot-AUS-NOT-A-CAMERA'), undefined)).status).toBe(404);
    expect(state.calls).toEqual([]);
  });
});
