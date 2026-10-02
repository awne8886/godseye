/**
 * Security (round 9): the new link-out camera operators (MLIT river cameras, City of Edmonton) never
 * reach an upstream through the stills proxy or the stream-status probe, whatever URL a catalogue
 * row might carry; a provider declaring `frameTypes` refuses an operator placeholder; Edmonton is
 * withheld on commercial deployments; the AeroAPI key travels only in the `x-apikey` header.
 */
import type * as Ssrf from '@/lib/ssrf';
import type * as Http from '@/lib/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Camera } from '@/lib/types';

const state = vi.hoisted(() => ({
  fetches: [] as string[],
  http: [] as { url: string; headers: Record<string, string> }[],
  type: 'image/png',
}));

vi.mock('@/lib/ssrf', async (orig) => {
  const real = await orig<typeof Ssrf>();
  return {
    ...real,
    allowListedFetch: async (url: string, rules: Parameters<typeof real.matchesAllowList>[1]) => {
      state.fetches.push(url);
      if (!real.matchesAllowList(new URL(url), rules)) throw Object.assign(new Error('blocked'), { code: 'blocked', url });
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
      return { status: 200, ok: true, notModified: false, headers: { 'content-type': state.type }, body: png, url, etag: null, lastModified: null, ms: 1, attempts: 1 };
    },
  };
});

vi.mock('@/lib/http', async (orig) => {
  const real = await orig<typeof Http>();
  return {
    ...real,
    httpJson: async (url: string, opts: { headers?: Record<string, string> } = {}) => {
      state.http.push({ url, headers: { ...(opts.headers ?? {}) } });
      return { data: { flights: [] }, status: 200, ok: true, headers: {}, url, ms: 1, attempts: 1 };
    },
  };
});

const { fetchFrame, probeCamera } = await import('@/features/surveillance/server/frames');
const { providerDef, rulesFor, PROVIDERS } = await import('@/features/surveillance/server/registry');
const { providerEnabled } = await import('@/features/surveillance/server/catalog');
const { aeroSchedule } = await import('@/features/flight-paths/server/aeroapi');

const cam = (id: string, providerId: string, url: string): Camera =>
  ({ id, lat: 0, lng: 0, name: 'x', providerId, city: null, country: 'XX', streamType: 'jpg', stillUrl: url, streamUrl: url, externalUrl: null, observedAt: null, source: 'x' }) as unknown as Camera;

beforeEach(() => {
  state.fetches = [];
  state.http = [];
  state.type = 'image/png';
});

describe('link-out operators never reach an upstream', () => {
  for (const id of ['mlit', 'edmonton'] as const) {
    it(`${id}: proxy and probe refuse without any fetch, even for a metadata/loopback URL`, async () => {
      const def = providerDef(id)!;
      expect(def).toBeTruthy();
      for (const url of ['http://169.254.169.254/latest/meta-data/', 'http://127.0.0.1/x.jpg', 'https://www.river.go.jp/kawabou/file/x.png', 'https://edmontontrafficcam.com/x.jpg']) {
        expect(rulesFor(def, url)).toEqual([]);
        const r = await fetchFrame(cam(`${id}-1`, id, url), def);
        expect(r).toMatchObject({ ok: false, status: 404, error: 'link_out_only', fetchedAt: null });
        const p = await probeCamera(cam(`${id}-1`, id, url), def);
        expect(p.status).toBe('unknown');
      }
      expect(state.fetches).toEqual([]);
    });
  }

  it('Edmonton (non-commercial terms) is off when COMMERCIAL_DEPLOYMENT=true', () => {
    expect(providerEnabled(providerDef('edmonton')!, { COMMERCIAL_DEPLOYMENT: 'true' })).toBe(false);
    expect(providerEnabled(providerDef('edmonton')!, {})).toBe(true);
  });
});

describe('operator placeholder is never relayed as a frame', () => {
  it('a provider with frameTypes refuses a PNG placeholder after one allow-listed fetch', async () => {
    const base = PROVIDERS.find((p) => p.row.id === 'toronto')!;
    const def = { ...base, frameTypes: ['image/jpeg'] as const };
    const url = 'https://opendata.toronto.ca/transportation/tmc/rescucameraimages/CameraImages/loc1.jpg';
    const r = await fetchFrame(cam('toronto-1', 'toronto', url), def);
    expect(r).toMatchObject({ ok: false, error: 'operator_placeholder' });
    expect(state.fetches).toEqual([url]);
  });

  it('the allow-list still blocks a catalogue URL outside the operator path (no relay of a private host)', async () => {
    const def = providerDef('toronto')!;
    const r = await fetchFrame(cam('toronto-2', 'toronto', 'http://169.254.169.254/transportation/tmc/rescucameraimages/CameraImages/loc1.jpg'), def);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).not.toBe('operator_placeholder');
  });
});

describe('AeroAPI key handling', () => {
  it('sends the key only in x-apikey, never in the URL; no request without the capability', async () => {
    const key = 'r9-secret-aeroapi-key-123';
    const none = await aeroSchedule('BAW117', {}, undefined, Date.now(), 50);
    expect(none.run.status.ok).toBe(false);
    expect(state.http).toEqual([]);
    const commercial = await aeroSchedule('BAW118', { AEROAPI_KEY: key, COMMERCIAL_DEPLOYMENT: 'true' }, undefined, Date.now(), 50);
    expect(commercial.run.status.ok).toBe(false);
    expect(state.http).toEqual([]);
    await aeroSchedule('BAW119', { AEROAPI_KEY: key }, undefined, Date.now(), 2_000);
    expect(state.http.length).toBe(1);
    const call = state.http[0]!;
    expect(new URL(call.url).hostname).toBe('aeroapi.flightaware.com');
    expect(call.url).not.toContain(key);
    expect(call.headers['x-apikey']).toBe(key);
    expect(Object.entries(call.headers).filter(([, v]) => v.includes(key)).map(([k]) => k)).toEqual(['x-apikey']);
  });
});
