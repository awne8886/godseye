import type * as Ssrf from '@/lib/ssrf';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { done, fresh, jpeg, req } from '@/features/surveillance/server/__fixtures__/helpers';

const state = vi.hoisted(() => ({ calls: [] as string[], body: null as Buffer | null, type: 'image/jpeg' }));
vi.mock('@/features/surveillance/server/loaders', async () => {
  const { fixtureLoaders } = await import('@/features/surveillance/server/__fixtures__/loaders');
  return { LOADERS: fixtureLoaders() };
});
vi.mock('@/lib/ssrf', async (orig) => {
  const real = await orig<typeof Ssrf>();
  return {
    ...real,
    // Enforce the provider's rules exactly as the real guard does, then answer from the fixture.
    allowListedFetch: async (url: string, rules: Parameters<typeof real.matchesAllowList>[1]) => {
      state.calls.push(url);
      if (!real.matchesAllowList(new URL(url), rules)) throw Object.assign(new Error('blocked'), { code: 'blocked' });
      return { status: 200, ok: true, notModified: false, headers: { 'content-type': state.type, 'last-modified': 'Wed, 30 Sep 2026 20:03:10 GMT' }, body: state.body!, url, etag: null, lastModified: null, ms: 1, attempts: 1 };
    },
  };
});

const { GET } = await import('./route');

beforeEach(() => {
  fresh();
  state.calls = [];
  state.body = jpeg();
  state.type = 'image/jpeg';
});
afterEach(done);

describe('GET /api/cctv/proxy', () => {
  it('relays the catalogued still for a camera id (never a caller-supplied URL)', async () => {
    const res = await GET(req('/api/cctv/proxy?id=hktd-H429F'), undefined);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=60');
    expect(res.headers.get('x-frame-observed-at')).toBe('2026-09-30T20:03:10.000Z');
    expect(state.calls).toEqual(['https://tdcctv.data.one.gov.hk/H429F.JPG']);
  });

  it('refuses non-images from the operator', async () => {
    state.body = Buffer.from('<html>nope</html>');
    state.type = 'text/html';
    const res = await GET(req('/api/cctv/proxy?id=hktd-H429F'), undefined);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'frame_unavailable', detail: 'not_an_image' });
  });

  it('R2 MINOR-1: NSW HTML frames → SOURCE OFFLINE / not an image, and /api/cctv/providers marks NSW frames unavailable', async () => {
    const { FX, text } = await import('@/features/surveillance/server/__fixtures__');
    const { GET: providersGET } = await import('../providers/route');
    state.body = Buffer.from(text(FX.nswHtmlFrame)); // the 307-byte page NSW served for every .jpeg (probed 2026-10-01)
    state.type = 'text/html';
    for (const id of ['nsw-5-ways-miranda', 'nsw-airport-drive-mascot', 'nsw-alison-road-randwick']) {
      const res = await GET(req(`/api/cctv/proxy?id=${id}`), undefined);
      expect(res.status, id).toBe(502);
      expect(res.headers.get('content-type')).toMatch(/^application\/json/);
      const b = await res.json();
      expect(b).toMatchObject({ error: 'frame_unavailable', detail: 'not_an_image', state: 'offline', upstreamType: 'text/html' });
      expect(b.message).toMatch(/web page instead of an image/);
    }
    const p = await (await providersGET(req('/api/cctv/providers'), undefined)).json();
    expect(p.frames.nsw).toMatchObject({ state: 'unavailable', cameras: 3, camerasFailing: 3, errors: { not_an_image: 3 } });
    expect(p.frames.hktd.state).toBe('unchecked');
    expect(p.frames.rws).toBeUndefined(); // link-out-only providers relay no frames
  });

  it('relays the frame fetch time separately from the operator frame time', async () => {
    const res = await GET(req('/api/cctv/proxy?id=hktd-H429F'), undefined);
    expect(res.headers.get('x-frame-time-source')).toBe('last-modified');
    expect(Date.parse(res.headers.get('x-frame-fetched-at')!)).toBeGreaterThan(Date.parse(res.headers.get('x-frame-observed-at')!));
  });

  it('404s unknown ids and link-out cameras; 400s bad input; ignores url params', async () => {
    expect((await GET(req('/api/cctv/proxy?id=hktd-NOPE'), undefined)).status).toBe(404);
    expect((await GET(req('/api/cctv/proxy?id=evil-1'), undefined)).status).toBe(404);
    expect((await GET(req('/api/cctv/proxy?id=rws-4'), undefined)).status).toBe(404);
    expect((await GET(req('/api/cctv/proxy'), undefined)).status).toBe(400);
    expect((await GET(req('/api/cctv/proxy?url=http://169.254.169.254/latest'), undefined)).status).toBe(400);
    expect(state.calls).toEqual([]);
  });
});
