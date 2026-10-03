/**
 * Security (round 11): a FlightAware AeroAPI schedule cached while the `aeroapi` capability was on
 * is never served once COMMERCIAL_DEPLOYMENT=true (or the key is removed), and no request leaves.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as HttpModule from '@/lib/http';

const calls: string[] = [];
vi.mock('@/lib/http', async (orig) => {
  const real = await orig<typeof HttpModule>();
  return {
    ...real,
    httpJson: vi.fn(async (url: string | URL) => {
      calls.push(String(url));
      const out = new Date(Date.now() + 3_600_000).toISOString();
      return {
        ok: true,
        status: 200,
        url: String(url),
        headers: {},
        data: { flights: [{ ident: 'R11GATE', ident_icao: 'R11GATE', origin: { code_icao: 'EGLL' }, destination: { code_icao: 'KJFK' }, scheduled_out: out, status: 'Scheduled' }] },
      };
    }),
  };
});

const KEY = 'sk-AEROAPI-R11-0123456789';

afterEach(() => vi.restoreAllMocks());

describe('AeroAPI schedule cache after the licence gate closes', () => {
  it('serves nothing cached and sends nothing when COMMERCIAL_DEPLOYMENT=true or the key is gone', async () => {
    const { aeroSchedule } = await import('../aeroapi');
    const before = await aeroSchedule('R11GATE', { AEROAPI_KEY: KEY }, undefined, Date.now(), 5_000);
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(before.run.status.ok).toBe(true);
    const sent = calls.length;

    const commercial = await aeroSchedule('R11GATE', { AEROAPI_KEY: KEY, COMMERCIAL_DEPLOYMENT: 'true' }, undefined, Date.now(), 5_000);
    const noKey = await aeroSchedule('R11GATE', {}, undefined, Date.now(), 5_000);
    for (const r of [commercial, noKey]) {
      expect(r.schedule).toBeNull();
      expect(r.run.status.ok).toBe(false);
      expect(r.run.status.skipped).toBeTruthy();
    }
    expect(calls.length).toBe(sent);
    expect(JSON.stringify([before, commercial, noKey])).not.toContain(KEY);
    for (const u of calls) expect(u).not.toContain(KEY);
  });
});
