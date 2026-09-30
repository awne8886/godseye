import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { done, fresh, req } from '@/features/surveillance/server/__fixtures__/helpers';
import { CameraProvidersResponse } from '@/lib/schemas/surveillance';
import { GET } from './route';

beforeEach(fresh);
afterEach(done);

describe('GET /api/cctv/providers', () => {
  it('lists every registry row with licence, attribution and terms, plus meta + providers', async () => {
    const res = await GET(req('/api/cctv/providers'), undefined);
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(CameraProvidersResponse.safeParse(b).success).toBe(true);
    expect(b.meta).toMatchObject({ feed: 'cctv-providers', kind: 'reference', state: 'reference' });
    expect(b.providers).toEqual({});
    expect(b.items.find((p: { id: string }) => p.id === 'tfl').attribution_string).toMatch(/Powered by TfL Open Data/);
    expect(b.meta.attribution.length).toBe(b.items.length);
  });
});
