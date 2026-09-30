import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { done, fresh, req } from '@/features/surveillance/server/__fixtures__/helpers';
import { CameraResolveResponse } from '@/lib/schemas/surveillance';

vi.mock('@/features/surveillance/server/loaders', async () => {
  const { fixtureLoaders } = await import('@/features/surveillance/server/__fixtures__/loaders');
  return { LOADERS: fixtureLoaders() };
});

const { GET } = await import('./route');

beforeEach(fresh);
afterEach(() => {
  vi.unstubAllEnvs();
  done();
});

describe('GET /api/cctv/resolve', () => {
  it('returns camera + provider row + the proxied still for a snapshot camera', async () => {
    const res = await GET(req('/api/cctv/resolve?id=hktd-H429F'), undefined);
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(CameraResolveResponse.safeParse(b).success).toBe(true);
    expect(b.provider).toMatchObject({ id: 'hktd', terms_url: 'https://data.gov.hk/en/terms-and-conditions' });
    expect(b.playable).toEqual({ type: 'jpg', url: '/api/cctv/proxy?id=hktd-H429F' });
  });

  it('Caltrans HLS falls back to the still until its host is on MEDIA_HOSTS', async () => {
    const b = await (await GET(req('/api/cctv/resolve?id=caltrans-d7-1'), undefined)).json();
    expect(b.camera.streamType).toBe('hls');
    expect(['hls', 'jpg']).toContain(b.playable.type);
  });

  it('link-out cameras resolve to nothing playable', async () => {
    const b = await (await GET(req('/api/cctv/resolve?id=quebec-4057'), undefined)).json();
    expect(CameraResolveResponse.safeParse(b).success).toBe(true);
    expect(b.playable).toBeNull();
    expect(b.provider.link_out_only).toBe(true);
    vi.stubEnv('CCTV_LINK_OUT_ONLY', 'asia');
    const lo = await (await GET(req('/api/cctv/resolve?id=hktd-H429F'), undefined)).json();
    expect(lo.playable).toBeNull();
    expect(lo.camera.stillUrl).toBeNull();
  });

  it('404 for unknown cameras', async () => {
    expect((await GET(req('/api/cctv/resolve?id=hktd-XXXX'), undefined)).status).toBe(404);
  });
});
