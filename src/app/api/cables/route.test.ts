import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { freshCache, req, resetCache } from '@/features/threats/server/__fixtures__/routes';
import { cablesFeed } from '@/features/network/server/cables';
import { MAX_RESPONSE_BYTES } from '@/lib/respond';
import { CablesResponse } from '@/lib/schemas';
import { GET } from './route';

beforeEach(freshCache);
afterEach(() => {
  cablesFeed.stop();
  resetCache();
  delete process.env.COMMERCIAL_DEPLOYMENT;
});

describe('GET /api/cables', () => {
  it('serves the bundled cables as REFERENCE, under 4 MB', async () => {
    const res = await GET(req('/api/cables'), undefined);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.length).toBeLessThan(MAX_RESPONSE_BYTES);
    const body = JSON.parse(text);
    expect(CablesResponse.safeParse(body).success).toBe(true);
    expect(body.meta).toMatchObject({ feed: 'cables', kind: 'reference', state: 'reference' });
    expect(body.providers.telegeography.ok).toBe(true);
  });

  it('is off on a commercial deployment (CC BY-NC-SA)', async () => {
    process.env.COMMERCIAL_DEPLOYMENT = 'true';
    const res = await GET(req('/api/cables'), undefined);
    expect(res.status).toBe(403);
    expect((await res.json()).providers.telegeography.skipped).toBe('licence');
  });
});
