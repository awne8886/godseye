import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as RateLimitModule from '@/lib/ratelimit';
import type * as HttpModule from '@/lib/http';
import { MemoryStore, clearL1, setStore } from '@/lib/cache';
import { evaluateCapability } from '@/lib/capabilities';
// Shaped from FlightAware's published AeroAPI v4 OpenAPI document (not a live capture: keyless = 401).
import docs from '../__fixtures__/aeroapi-v4-docs-shaped.json';
import type { AeroDeps } from './aeroapi';
import { AEROAPI_DISCLAIMER, AEROAPI_PENDING, aeroFiledPlans, aeroSchedule, fetchAeroFiledPlan, mapAeroRoute, pickFlight, type AeroFlight } from './aeroapi';

const http = vi.hoisted(() => ({ calls: [] as { url: string; headers: Record<string, string>; limiter: boolean; signal: boolean; deadlineMs?: number }[], status: 200 }));
const admit = vi.hoisted(() => ({ free: Infinity }));
const buckets = vi.hoisted(() => [] as [string, number, number | undefined][]);

vi.mock('@/lib/ratelimit', async (orig) => {
  const actual = await orig<typeof RateLimitModule>();
  return {
    ...actual,
    providerBucket: (name: string, rate: number, burst?: number) => {
      buckets.push([name, rate, burst]);
      return { take: async () => undefined, tryTake: () => (admit.free > 0 ? (admit.free--, true) : false) };
    },
  };
});

vi.mock('@/lib/http', async (orig) => {
  const actual = await orig<typeof HttpModule>();
  return {
    ...actual,
    httpJson: vi.fn(async (u: string, opts: { headers?: Record<string, string>; limiter?: unknown; signal?: AbortSignal; deadlineMs?: number }) => {
      http.calls.push({ url: u, headers: opts.headers ?? {}, limiter: !!opts.limiter, signal: opts.signal instanceof AbortSignal, deadlineMs: opts.deadlineMs });
      if (http.status >= 400) throw new actual.HttpError(`HTTP ${http.status}`, 'http', u, http.status);
      const path = new URL(u).pathname;
      const data = path.endsWith('/route') ? docs.flight_route : path.includes('/flights/to/') ? docs.flights_to : docs.flights_ident;
      return { data, status: 200, ok: true, notModified: false, headers: {}, body: Buffer.alloc(0), url: u, etag: null, lastModified: null, ms: 1, attempts: 1 };
    }),
  };
});

const KEY = 'test-key-not-real';
const NOW = Date.parse('2026-10-01T19:00:00Z');

describe('AeroAPI capability', () => {
  it('needs AEROAPI_KEY and is off on commercial deployments', () => {
    expect(evaluateCapability('aeroapi', {}).enabled).toBe(false);
    expect(evaluateCapability('aeroapi', { AEROAPI_KEY: KEY }).enabled).toBe(true);
    expect(evaluateCapability('aeroapi', { AEROAPI_KEY: KEY, COMMERCIAL_DEPLOYMENT: 'true' })).toEqual({ enabled: false, reason: 'COMMERCIAL_DEPLOYMENT is "true"' });
  });

  it('records the keyless probe as 401 (fixture metadata)', () => {
    expect(docs.keyless_probe.status).toBe(401);
    expect(docs.keyless_probe.body.reason).toBe('INVALID_API_KEY');
  });
});

describe('AeroAPI mapping', () => {
  it('pickFlight: the leg in progress, else the next scheduled, never a cancelled one', () => {
    const segs = docs.flights_to.flights.flatMap((f) => f.segments as AeroFlight[]);
    expect(pickFlight(segs, NOW)?.fa_flight_id).toBe('UAL1002-1759310000-airline-0002');
    const ident = docs.flights_ident.flights as AeroFlight[];
    // After the 1 Oct leg landed: the 2 Oct departure is next.
    expect(pickFlight(ident, Date.parse('2026-10-02T06:00:00Z'))?.fa_flight_id).toBe('UAL1002-1759396400-airline-0004');
    expect(pickFlight([{ ...segs[2]!, scheduled_out: '2026-10-03T00:00:00Z' }], NOW)).toBeNull();
  });

  it('mapAeroRoute drops fixes without coordinates and keeps nm distances only', () => {
    const plan = mapAeroRoute('X1', docs.flight_route.fixes, docs.flight_route.route_distance)!;
    expect(plan.waypoints.map((w) => w.ident)).toEqual(['KDEN', 'FIX1', 'FIX2', 'KORD']);
    expect(plan.distanceNm).toBe(888);
    expect(plan.source).toBe('FlightAware AeroAPI');
    expect(plan.disclaimer).toBe(AEROAPI_DISCLAIMER);
    expect(mapAeroRoute('X2', docs.flight_route.fixes, '1,022 mi')!.distanceNm).toBeNull();
    expect(mapAeroRoute('X3', docs.flight_route.fixes.slice(2, 3), null)).toBeNull();
  });

  it('fetchAeroFiledPlan reads the most recent departure and its decoded route (2 result sets)', async () => {
    const paths: string[] = [];
    const get = async <T,>(p: string): Promise<T> => {
      paths.push(p);
      return (p.endsWith('/route') ? docs.flight_route : docs.flights_to) as T;
    };
    const plans = await fetchAeroFiledPlan('KDEN', 'KORD', { get }, NOW);
    expect(paths).toEqual(['/airports/KDEN/flights/to/KORD?max_pages=1', '/flights/UAL1002-1759310000-airline-0002/route']);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.id).toBe('aeroapi:UAL1002-1759310000-airline-0002');
  });
});

describe('AeroAPI requests', () => {
  beforeEach(() => {
    clearL1();
    setStore(new MemoryStore());
    http.calls = [];
    http.status = 200;
    buckets.length = 0;
    admit.free = Infinity;
  });

  it('makes no request without the key', async () => {
    const r = await aeroFiledPlans('KDEN', 'KORD', {});
    expect(r.run.status.skipped).toBe('not-configured');
    expect((await aeroSchedule('UAL1002', {})).run.status.skipped).toBe('not-configured');
    expect(http.calls).toHaveLength(0);
  });

  it('sends the key only in x-apikey, admits the first call, bounds both by signal + deadline, and caches the pair', async () => {
    const r = await aeroFiledPlans('KDEN', 'KORD', { AEROAPI_KEY: KEY });
    expect(r.run.status.ok).toBe(true);
    expect(r.plans).toHaveLength(1);
    expect(http.calls).toHaveLength(2);
    for (const c of http.calls) {
      expect(c.url.startsWith('https://aeroapi.flightaware.com/aeroapi/')).toBe(true);
      expect(c.url).not.toContain(KEY);
      expect(c.headers['x-apikey']).toBe(KEY);
      expect(c.signal).toBe(true);
      expect(c.deadlineMs).toBeGreaterThan(0);
    }
    // The first request used the token taken at admission; the second waits on the bucket (bounded by the signal).
    expect(http.calls.map((c) => c.limiter)).toEqual([false, true]);
    expect(buckets.every(([name, rate, burst]) => name === 'aeroapi.flightaware.com' && rate === 0.1 && burst === 2)).toBe(true);
    await aeroFiledPlans('KDEN', 'KORD', { AEROAPI_KEY: KEY });
    expect(http.calls).toHaveLength(2);
  });

  it('never queues: no free token → skipped "budget" and no request', async () => {
    admit.free = 0;
    const r = await aeroFiledPlans('KDEN', 'KORD', { AEROAPI_KEY: KEY });
    expect(r.plans).toEqual([]);
    expect(r.run.status).toMatchObject({ ok: false, count: 0, skipped: 'budget' });
    expect((await aeroSchedule('UAL1002', { AEROAPI_KEY: KEY })).run.status.skipped).toBe('budget');
    expect(http.calls).toHaveLength(0);
  });

  it('does not hold the plan: a slow refresh answers "pending", finishes in the background and fills the cache', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let admissions = 0;
    const signals: AbortSignal[] = [];
    const deps: AeroDeps = {
      tryAdmit: () => (admissions++, true),
      get: async <T,>(p: string, o: { signal: AbortSignal }) => {
        signals.push(o.signal);
        await gate;
        return (p.endsWith('/route') ? docs.flight_route : docs.flights_to) as T;
      },
    };
    const env = { AEROAPI_KEY: KEY };
    const t0 = Date.now();
    const first = await aeroFiledPlans('KSFO', 'KORD', env, deps, 30);
    expect(Date.now() - t0).toBeLessThan(1_000);
    expect(first.plans).toEqual([]);
    expect(first.run.status).toMatchObject({ ok: false, error: AEROAPI_PENDING });
    // A second caller joins the running refresh: no second admission.
    expect((await aeroFiledPlans('KSFO', 'KORD', env, deps, 10)).run.status.error).toBe(AEROAPI_PENDING);
    expect(admissions).toBe(1);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    release();
    await vi.waitFor(async () => expect((await aeroFiledPlans('KSFO', 'KORD', env, deps, 10)).plans).toHaveLength(1));
    expect(admissions).toBe(1);
  });

  it('a 401 is a failed provider, not an empty answer', async () => {
    http.status = 401;
    const r = await aeroSchedule('UAL1002', { AEROAPI_KEY: KEY });
    expect(r.schedule).toBeNull();
    expect(r.run.status.ok).toBe(false);
    expect(r.run.status.error).toBeTruthy();
  });

  it('aeroSchedule maps the chosen flight', async () => {
    const r = await aeroSchedule('UAL1002', { AEROAPI_KEY: KEY }, undefined, Date.parse('2026-10-02T06:00:00Z'));
    expect(r.schedule).toMatchObject({ callsign: 'UAL1002', iataFlight: 'UA1002', origin: 'KDEN', destination: 'KORD', scheduledOut: '2026-10-02T18:00:00Z' });
    expect(http.calls[0]!.url).toBe('https://aeroapi.flightaware.com/aeroapi/flights/UAL1002?max_pages=1');
  });
});
