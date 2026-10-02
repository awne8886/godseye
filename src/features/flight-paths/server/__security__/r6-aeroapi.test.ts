/**
 * Security (round 6): AEROAPI_KEY travels only in the x-apikey header — never in a URL, a log line,
 * a response or an error — and the adapter makes no request without the capability (no key, or
 * COMMERCIAL_DEPLOYMENT=true).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as HttpModule from '@/lib/http';

const calls: { url: string; headers: Record<string, string> }[] = [];
let mode: 'ok' | 'fail' = 'ok';
vi.mock('@/lib/http', async (orig) => {
  const real = await orig<typeof HttpModule>();
  return {
    ...real,
    httpJson: vi.fn(async (url: string | URL, opts: { headers?: Record<string, string> } = {}) => {
      calls.push({ url: String(url), headers: { ...(opts.headers ?? {}) } });
      if (mode === 'fail') throw new real.HttpError('HTTP 401', 'http', String(url), 401);
      return { ok: true, status: 200, data: { flights: [] }, headers: {}, url: String(url) };
    }),
  };
});

const SECRET = 'sk-AEROAPI-SECRET-0123456789';
const logs: string[] = [];

describe('AeroAPI key handling', () => {
  beforeEach(() => {
    calls.length = 0;
    logs.length = 0;
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.map((x) => (x instanceof Error ? `${x.message} ${x.stack}` : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')));
    }
  });
  afterEach(() => vi.restoreAllMocks());

  it('makes no request without a key or on a commercial deployment', async () => {
    const { aeroSchedule, aeroFiledPlans } = await import('../aeroapi');
    const a = await aeroSchedule('BAW117', {});
    const b = await aeroFiledPlans('KJFK', 'KLAX', { AEROAPI_KEY: SECRET, COMMERCIAL_DEPLOYMENT: 'true' });
    expect(a.run.status.skipped).toBe('not-configured');
    expect(b.run.status.skipped).toBe('not-configured');
    expect(calls).toHaveLength(0);
  });

  it('sends the key only as x-apikey, never in the URL, logs or result (success and failure)', async () => {
    const { aeroSchedule } = await import('../aeroapi');
    mode = 'ok';
    const ok = await aeroSchedule('SECOK1', { AEROAPI_KEY: SECRET }, undefined, Date.now(), 5_000);
    mode = 'fail';
    const bad = await aeroSchedule('SECBAD1', { AEROAPI_KEY: SECRET }, undefined, Date.now(), 5_000);
    expect(calls.length).toBeGreaterThanOrEqual(1);
    for (const c of calls) {
      expect(new URL(c.url).hostname).toBe('aeroapi.flightaware.com');
      expect(c.url).not.toContain(SECRET);
      expect(c.headers['x-apikey']).toBe(SECRET);
      expect(Object.keys(c.headers).filter((k) => k !== 'x-apikey').every((k) => !c.headers[k]!.includes(SECRET))).toBe(true);
    }
    expect(JSON.stringify([ok, bad])).not.toContain(SECRET);
    expect(logs.join('\n')).not.toContain(SECRET);
  });
});
