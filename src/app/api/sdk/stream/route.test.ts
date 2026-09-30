import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { req } from '@/features/threats/server/__fixtures__/routes';
import { ingest, resetSdk } from '@/features/network/server/sdk';
import { GET } from './route';

beforeEach(resetSdk);
afterEach(() => {
  delete process.env.SDK_INGEST_KEY;
});

describe('GET /api/sdk/stream', () => {
  it('is 403 while SDK ingest is not configured', async () => {
    const res = await GET(req('/api/sdk/stream'), undefined);
    expect(res.status).toBe(403);
    expect((await res.json()).providers.sdk.skipped).toBe('not-configured');
  });

  it('streams a snapshot of third-party entities', async () => {
    process.env.SDK_INGEST_KEY = 'k';
    ingest({ entities: [{ id: 'a1', name: 'A', domain: 'AIR', entityType: 'TRACK', position: { lat: 1, lng: 1 }, timestamp: '2026-09-30T20:00:00Z', source: { system: 's' } }] });
    const ac = new AbortController();
    const res = await GET(req('/api/sdk/stream', { signal: ac.signal }), undefined);
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    let text = '';
    while (!text.includes('event: snapshot')) text += new TextDecoder().decode((await reader.read()).value);
    expect(text).toContain('"thirdParty":true');
    ac.abort();
    await reader.cancel().catch(() => undefined);
  });
});
