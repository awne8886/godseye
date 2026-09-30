import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { freshCache, req, resetCache } from '@/features/threats/server/__fixtures__/routes';
import { applyAis, maritimeFeed, resetAis } from '@/features/maritime/server/maritime';
import { MAX_RESPONSE_BYTES } from '@/lib/respond';
import { MaritimeResponse } from '@/lib/schemas';
import type { Vessel } from '@/lib/types';
import { GET } from './route';

beforeEach(() => {
  freshCache();
  resetAis();
  delete process.env.AIS_API_KEY;
});
afterEach(() => {
  maritimeFeed.stop();
  resetCache();
});

describe('GET /api/maritime', () => {
  it('serves REFERENCE ports and chokepoints keyless, with AIS reported not configured', async () => {
    const res = await GET(req('/api/maritime'), undefined);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.length).toBeLessThan(MAX_RESPONSE_BYTES);
    const body = JSON.parse(text);
    expect(MaritimeResponse.safeParse(body).success).toBe(true);
    expect(body.ports.length).toBeGreaterThan(500);
    expect(body.chokepoints).toHaveLength(10);
    expect(body.vessels).toEqual([]);
    expect(body.aisConfigured).toBe(false);
    expect(body.ports.every((p: { live: unknown; observedAt: unknown }) => p.live === null && p.observedAt === null)).toBe(true);
    expect(body.chokepoints.every((c: { shipsNearby: unknown }) => c.shipsNearby === null)).toBe(true);
    expect(body.providers.aisstream).toMatchObject({ ok: false, skipped: 'not-configured' });
    expect(body.providers.reference.ok).toBe(true);
    expect(body.meta.kind).toBe('mixed');
  });

  it('rejects a malformed bbox', async () => {
    expect((await GET(req('/api/maritime?bbox=1,2,3'), undefined)).status).toBe(400);
  });

  it('applies AIS messages into vessels with a speed track (relay unit)', () => {
    const map = new Map<string, Vessel & { seenAt: number }>();
    const t0 = Date.parse('2026-09-30T20:00:00Z');
    applyAis(map, { MessageType: 'PositionReport', MetaData: { MMSI: 211000001, time_utc: '2026-09-30 20:00:00.123 +0000 UTC' }, Message: { PositionReport: { Latitude: 54, Longitude: 10, Sog: 12.3, Cog: 90, TrueHeading: 511 } } }, t0);
    applyAis(map, { MessageType: 'ShipStaticData', MetaData: { MMSI: 211000001 }, Message: { ShipStaticData: { Type: 80, Name: 'TEST TANKER ', CallSign: 'DABC' } } }, t0 + 1000);
    applyAis(map, { MessageType: 'PositionReport', MetaData: { MMSI: 211000001, time_utc: '2026-09-30 20:02:00 +0000 UTC' }, Message: { PositionReport: { Latitude: 54.01, Longitude: 10.02, Sog: 12.1, Cog: 91 } } }, t0 + 120_000);
    const v = map.get('211000001')!;
    expect(v).toMatchObject({ type: 'tanker', name: 'TEST TANKER', callsign: 'DABC', sogKt: 12.1, headingDeg: null, observedAt: '2026-09-30T20:02:00.000Z' });
    expect(v.track).toHaveLength(2);
  });
});
