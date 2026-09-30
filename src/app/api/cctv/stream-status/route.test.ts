import type * as Ssrf from '@/lib/ssrf';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { done, fresh, jpeg, req } from '@/features/surveillance/server/__fixtures__/helpers';
import { StreamStatusResponse } from '@/lib/schemas/surveillance';

const state = vi.hoisted(() => ({ calls: 0, status: 200 }));
vi.mock('@/features/surveillance/server/loaders', async () => {
  const { fixtureLoaders } = await import('@/features/surveillance/server/__fixtures__/loaders');
  return { LOADERS: fixtureLoaders() };
});
vi.mock('@/lib/ssrf', async (orig) => {
  const real = await orig<typeof Ssrf>();
  return {
    ...real,
    allowListedFetch: async (url: string) => {
      state.calls++;
      const { jpeg: j } = await import('@/features/surveillance/server/__fixtures__/helpers');
      const hls = url.endsWith('.m3u8');
      return { status: state.status, ok: state.status < 300, notModified: false, headers: { 'content-type': hls ? 'application/vnd.apple.mpegurl' : 'image/jpeg' }, body: hls ? Buffer.from('#EXTM3U\n') : j(), url, etag: null, lastModified: null, ms: 1, attempts: 1 };
    },
  };
});

const { GET } = await import('./route');

beforeEach(() => {
  fresh();
  state.calls = 0;
  state.status = 200;
});
afterEach(done);

describe('GET /api/cctv/stream-status', () => {
  it('probes the HLS playlist for real and caches the answer 60 s', async () => {
    const res = await GET(req('/api/cctv/stream-status?id=caltrans-d7-1'), undefined);
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(StreamStatusResponse.safeParse(b).success).toBe(true);
    expect(b).toMatchObject({ id: 'caltrans-d7-1', status: 'online', httpStatus: 200 });
    expect(b.providers.caltrans).toMatchObject({ ok: true, count: 1 });
    expect(typeof b.timestamp).toBe('string');
    await GET(req('/api/cctv/stream-status?id=caltrans-d7-1'), undefined);
    expect(state.calls).toBe(1);
  });

  it('reports offline with the upstream status', async () => {
    state.status = 404;
    const b = await (await GET(req('/api/cctv/stream-status?id=dgt-2'), undefined)).json();
    expect(StreamStatusResponse.safeParse(b).success).toBe(true);
    expect(b).toMatchObject({ status: 'offline', httpStatus: 404 });
    expect(jpeg().length).toBeGreaterThan(0);
  });

  it('link-out cameras are unknown (nothing to probe)', async () => {
    const b = await (await GET(req('/api/cctv/stream-status?id=rws-4'), undefined)).json();
    expect(b).toMatchObject({ status: 'unknown', httpStatus: null });
    expect(state.calls).toBe(0);
  });
});
