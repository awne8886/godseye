/**
 * Security (round 10): licence gates must hold on every READ, not only when a cache refreshes
 * (the round-8 CCTV/Edmonton BLOCKING, same root cause). Open-Meteo's free tier is non-commercial
 * (`openmeteo` capability, off when COMMERCIAL_DEPLOYMENT=true). An instance that ran
 * non-commercially and restarts with COMMERCIAL_DEPLOYMENT=true on the same SnapshotStore
 * (docker-compose: filesystem store on /data) must not keep serving the cached Open-Meteo rows.
 *
 * "Restart" is simulated by keeping the SnapshotStore and clearing the in-process L1 and lookup
 * handles. Upstreams are recorded fixtures; after the flip no upstream answers at all.
 */
import type * as Http from '@/lib/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FX, type Route } from '@/features/hazards/server/__fixtures__';
import { req } from '@/features/hazards/server/__fixtures__/routes';
import { resetLookups } from '@/features/hazards/server/lookup';
import { clearL1, MemoryStore, setStore } from '@/lib/cache';
import { hasCapability } from '@/lib/capabilities';

const state = vi.hoisted(() => ({ routes: [] as Route[], calls: [] as string[] }));
vi.mock('@/lib/http', async (importOriginal) => {
  const orig = await importOriginal<typeof Http>();
  const { httpMock } = await import('@/features/hazards/server/__fixtures__');
  const m = httpMock(() => state.routes, orig.HttpError);
  return {
    ...orig,
    ...m,
    httpJson: async (input: string | URL, ...rest: unknown[]) => {
      state.calls.push(String(input));
      return (m.httpJson as (i: string | URL, ...r: unknown[]) => Promise<unknown>)(input, ...rest);
    },
  };
});

const { GET } = await import('@/app/api/air-quality/route');

const T0 = Date.parse('2026-10-02T12:00:00Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  state.calls = [];
  clearL1();
  resetLookups();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  setStore(undefined);
});

/** Process restart on the same SnapshotStore: the in-memory L1 and lookup handles are gone. */
function restart(): void {
  clearL1();
  resetLookups();
}

describe('Open-Meteo licence gate after COMMERCIAL_DEPLOYMENT is switched on', () => {
  it('a non-commercial run caches Open-Meteo rows (control)', async () => {
    setStore(new MemoryStore());
    state.routes = [['air-quality-api.open-meteo.com', FX.aq]];
    const res = await GET(req('/api/air-quality'), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.providers['open-meteo']).toMatchObject({ ok: true });
  });

  it('after a restart with COMMERCIAL_DEPLOYMENT=true no cached Open-Meteo row is served (right away, or after the TTL)', async () => {
    const store = new MemoryStore();
    setStore(store);
    state.routes = [['air-quality-api.open-meteo.com', FX.aq]];
    expect((await GET(req('/api/air-quality'), undefined)).status).toBe(200);

    restart();
    vi.stubEnv('COMMERCIAL_DEPLOYMENT', 'true');
    expect(hasCapability('openmeteo')).toBe(false);
    state.routes = []; // nothing answers any more
    state.calls = [];

    const now = await (await GET(req('/api/air-quality'), undefined)).json();
    expect(now.items ?? []).toEqual([]);
    expect(now.providers['open-meteo']).toMatchObject({ ok: false, skipped: 'licence' });

    // Past the 30-min TTL the gated refresh yields "no data"; the old rows must not live on as stale.
    vi.setSystemTime(T0 + 31 * 60_000);
    const later = await (await GET(req('/api/air-quality'), undefined)).json();
    expect(later.items ?? []).toEqual([]);
    expect(later.providers['open-meteo']).toMatchObject({ ok: false, skipped: 'licence' });
    expect(state.calls).toEqual([]);
  });
});
