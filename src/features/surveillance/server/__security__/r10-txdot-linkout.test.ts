/**
 * Security (round 10): the region-level link-out-only mode (§0.7, `CCTV_LINK_OUT_ONLY`) must hold on
 * EVERY frame path. With `CCTV_LINK_OUT_ONLY=texas` (or `US`), /api/cctv/proxy refuses a TxDOT
 * camera as `link_out_only` without contacting TxDOT — and /api/cctv/texas/snapshot must do the same.
 * Upstream calls are recorded through a stubbed allowListedFetch (recorded TxDOT fixture body).
 */
import type * as Ssrf from '@/lib/ssrf';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Camera } from '@/lib/types';

const state = vi.hoisted(() => ({ fetches: [] as string[] }));

vi.mock('@/lib/ssrf', async (orig) => {
  const real = await orig<typeof Ssrf>();
  const { FX, json } = await import('@/features/surveillance/server/__fixtures__/index');
  return {
    ...real,
    allowListedFetch: async (url: string, rules: Parameters<typeof real.matchesAllowList>[1]) => {
      state.fetches.push(url);
      if (!real.matchesAllowList(new URL(url), rules)) throw Object.assign(new Error('blocked'), { code: 'blocked', url });
      const body = Buffer.from(JSON.stringify(json(FX.txdotSnapshot)));
      return { status: 200, ok: true, notModified: false, headers: { 'content-type': 'application/json' }, body, url, etag: null, lastModified: null, ms: 1, attempts: 1 };
    },
  };
});

const TX_ID = 'txdot-ABL-ABL-FM707 @ SH89';
const TX_STILL = 'https://its.txdot.gov/its/DistrictIts/GetCctvSnapshotByIcdId?districtCode=ABL&icdId=ABL-FM707%20%40%20SH89';

vi.mock('@/features/surveillance/server/catalog', async (orig) => {
  const real = await orig<typeof import('@/features/surveillance/server/catalog')>();
  const { providerDef } = await import('@/features/surveillance/server/registry');
  const camera = {
    id: TX_ID, lat: 32.35, lng: -99.79, name: 'ABL-FM707 @ SH89', providerId: 'txdot', city: null, country: 'US', streamType: 'jpg',
    stillUrl: TX_STILL, streamUrl: null, externalUrl: 'https://its.txdot.gov/its/District/ABL/cameras', headingDeg: 0, observedAt: null, source: 'txdot',
  } as unknown as Camera;
  return { ...real, findCamera: async (id: string) => (id === TX_ID ? { camera, def: providerDef('txdot')! } : null) };
});

const { GET: snapshotGET } = await import('@/app/api/cctv/texas/snapshot/route');
const { GET: proxyGET } = await import('@/app/api/cctv/proxy/route');

let n = 0;
const req = (path: string) => new Request(`http://localhost${path}`, { headers: { 'x-forwarded-for': `10.77.${(++n >> 8) & 255}.${n & 255}` } });
const q = `?id=${encodeURIComponent(TX_ID)}`;

const saved = process.env.CCTV_LINK_OUT_ONLY;
beforeEach(() => {
  state.fetches = [];
});
afterEach(() => {
  if (saved === undefined) delete process.env.CCTV_LINK_OUT_ONLY;
  else process.env.CCTV_LINK_OUT_ONLY = saved;
});

describe('TxDOT frames without link-out mode (control)', () => {
  it('the snapshot route relays the recorded TxDOT still', async () => {
    delete process.env.CCTV_LINK_OUT_ONLY;
    const res = await snapshotGET(req(`/api/cctv/texas/snapshot${q}`), undefined);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(state.fetches).toEqual([TX_STILL]);
  });
});

describe('CCTV_LINK_OUT_ONLY holds on every frame path (§0.7)', () => {
  for (const mode of ['texas', 'US']) {
    it(`CCTV_LINK_OUT_ONLY=${mode}: /api/cctv/proxy refuses without contacting TxDOT`, async () => {
      process.env.CCTV_LINK_OUT_ONLY = mode;
      const res = await proxyGET(req(`/api/cctv/proxy${q}`), undefined);
      expect(res.status).toBe(404);
      expect(res.headers.get('x-frame-error')).toBe('link_out_only');
      expect(state.fetches).toEqual([]);
    });

    it(`CCTV_LINK_OUT_ONLY=${mode}: /api/cctv/texas/snapshot refuses without contacting TxDOT`, async () => {
      process.env.CCTV_LINK_OUT_ONLY = mode;
      const res = await snapshotGET(req(`/api/cctv/texas/snapshot${q}`), undefined);
      expect(res.headers.get('content-type')).not.toBe('image/jpeg');
      expect(res.status).toBe(404);
      expect(res.headers.get('x-frame-error')).toBe('link_out_only');
      expect(state.fetches).toEqual([]);
    });
  }
});
