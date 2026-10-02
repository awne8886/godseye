import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { req } from '@/features/threats/server/__fixtures__/routes';
import { resetSdk, sdkSnapshot } from '@/features/network/server/sdk';
import { SdkIngestResponse } from '@/lib/schemas';
import { POST } from './route';

const entity = { id: 'trk-7', name: 'Buoy 7', domain: 'SEA', entityType: 'SENSOR', position: { lat: 1, lng: 2 }, timestamp: '2026-09-30T20:00:00Z', source: { system: 'partner' } };
const post = (body: string, headers: Record<string, string> = {}) => req('/api/sdk/ingest', { method: 'POST', body, headers: { 'content-type': 'application/json', ...headers } });

beforeEach(() => {
  resetSdk();
  process.env.SDK_INGEST_KEY = 'k3y-for-tests';
});
afterEach(() => {
  delete process.env.SDK_INGEST_KEY;
});

describe('POST /api/sdk/ingest', () => {
  it('fails closed without a configured key', async () => {
    delete process.env.SDK_INGEST_KEY;
    const res = await POST(post(JSON.stringify({ entities: [entity] }), { authorization: 'Bearer anything' }), undefined);
    expect(res.status).toBe(503);
    expect(sdkSnapshot().entities).toHaveLength(0);
  });

  it('rejects a missing or wrong Bearer', async () => {
    expect((await POST(post(JSON.stringify({ entities: [entity] })), undefined)).status).toBe(401);
    expect((await POST(post(JSON.stringify({ entities: [entity] }), { authorization: 'Bearer k3y-for-test' }), undefined)).status).toBe(401);
  });

  it('caps the body and rejects malformed JSON', async () => {
    const auth = { authorization: 'Bearer k3y-for-tests' };
    expect((await POST(post('x'.repeat(300 * 1024), auth), undefined)).status).toBe(413);
    expect((await POST(post('{nope', auth), undefined)).status).toBe(400);
    expect((await POST(post(JSON.stringify({ entities: 'x' }), auth), undefined)).status).toBe(400);
  });

  it('accepts a valid batch, labels it third-party and reports rejects', async () => {
    const res = await POST(post(JSON.stringify({ entities: [entity, { ...entity, position: { lat: 99, lng: 0 } }] }), { authorization: 'Bearer k3y-for-tests' }), undefined);
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(SdkIngestResponse.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ accepted: 1, rejected: 1 });
    expect(sdkSnapshot().entities[0]).toMatchObject({ id: 'trk-7', thirdParty: true, label: 'THIRD-PARTY (SDK)' });
  });
});
