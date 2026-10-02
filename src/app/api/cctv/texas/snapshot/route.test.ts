import type * as Ssrf from '@/lib/ssrf';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FX, text } from '@/features/surveillance/server/__fixtures__';
import { done, fresh, jpeg, req } from '@/features/surveillance/server/__fixtures__/helpers';

const state = vi.hoisted(() => ({ calls: [] as string[], body: null as string | null }));
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
      return { status: 200, ok: true, notModified: false, headers: { 'content-type': 'application/json; charset=utf-8' }, body: Buffer.from(state.body ?? t(fx.txdotSnapshot)), url, etag: null, lastModified: null, ms: 1, attempts: 1 };
    },
  };
});

const { GET } = await import('./route');

beforeEach(() => {
  fresh();
  state.calls = [];
  state.body = null;
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

  it('round 5 (R2 MAJOR-1): TxDOT `null` (recorded 2026-10-01) → 404 FrameError JSON on both frame routes, never a 500', async () => {
    const { GET: proxyGET } = await import('../../proxy/route');
    const { GET: providersGET } = await import('../../providers/route');
    const { FrameError, CameraProvidersResponse } = await import('@/lib/schemas/surveillance');
    state.body = text(FX.txdotSnapshotNull);
    const id = encodeURIComponent('txdot-AUS-FM-734 @ US-290 EB');
    for (const res of [await GET(req(`/api/cctv/texas/snapshot?id=${id}`), undefined), await proxyGET(req(`/api/cctv/proxy?id=${id}`), undefined)]) {
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toMatch(/^application\/json/);
      expect(res.headers.get('cache-control')).toBe('no-store, max-age=0');
      const body = await res.json();
      expect(FrameError.safeParse(body).success).toBe(true);
      expect(body).toMatchObject({ error: 'frame_unavailable', detail: 'no_snapshot', state: 'offline', upstreamType: null });
      expect(body.fetchedAt).toMatch(/Z$/);
    }
    expect(state.calls).toHaveLength(2);
    // Recorded against the camera: TxDOT's frames are not judged by a camera without a snapshot.
    const p = await (await providersGET(req('/api/cctv/providers'), undefined)).json();
    expect(CameraProvidersResponse.safeParse(p).success).toBe(true);
    expect(p.frames.txdot).toMatchObject({ state: 'inconclusive', attempts: 2, cameras: 1, camerasFailing: 1, camerasOperatorFault: 0, errors: { no_snapshot: 2 } });
  });

  it('hostile TxDOT bodies never produce a 500', async () => {
    const id = encodeURIComponent('txdot-AUS-FM-734 @ US-290 EB');
    for (const b of ['', '[]', '[null]', '"x"', '0', 'false', '{}', '{"snippet":[]}', '{"snippet":{"a":1}}', 'not json', '{"snippet":"QUJD"}']) {
      state.body = b;
      const res = await GET(req(`/api/cctv/texas/snapshot?id=${id}`), undefined);
      // 404 = no snapshot for this camera; 502 = the operator answered something unreadable.
      expect([404, 502], b).toContain(res.status);
      expect((await res.json()).error, b).toBe('frame_unavailable');
    }
  });
});
