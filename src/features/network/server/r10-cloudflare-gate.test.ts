/**
 * Security (round 10): Cloudflare Radar data is CC BY-NC (capability `cloudflare`, off when
 * COMMERCIAL_DEPLOYMENT=true). The outages feed merges Cloudflare annotations with IODA; after a
 * restart with COMMERCIAL_DEPLOYMENT=true on the same SnapshotStore, no cached Cloudflare row may be
 * served — also when IODA fails and the feed would otherwise keep its last-good snapshot. Also the
 * round-10 MINOR: a token on a commercial deployment is skipped 'licence', not 'not-configured'.
 */
import type * as Http from '@/lib/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FX, type Call, type Route } from '@/features/threats/server/__fixtures__';
import { req } from '@/features/threats/server/__fixtures__/routes';
import { clearL1, MemoryStore, setStore } from '@/lib/cache';
import { attackOriginsFeed, outagesFeed } from './outages';
import { capabilityGate, skipReason } from './gate';

const state = vi.hoisted(() => ({ routes: [] as Route[], calls: [] as Call[] }));
vi.mock('@/lib/http', async (importOriginal) => {
  const orig = await importOriginal<typeof Http>();
  const { httpMock } = await import('@/features/threats/server/__fixtures__');
  return { ...orig, ...httpMock(() => state.routes, orig.HttpError, state.calls) };
});

const { GET } = await import('@/app/api/outages/route');

/** Cloudflare Radar `annotations/outages` answer in the documented shape. */
const CF_OUTAGES = Buffer.from(JSON.stringify({ result: { annotations: [{ id: 'r10', description: 'Power outage', scope: 'Nationwide', startDate: '2026-09-30T08:00:00Z', endDate: null, locations: ['BM'], outage: { outageCause: 'POWER_OUTAGE', outageType: 'NATIONWIDE' } }] } }));
const T0 = Date.parse('2026-09-30T20:10:00Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: T0 });
  vi.stubEnv('CLOUDFLARE_API_TOKEN', 'test-token');
  state.calls.length = 0;
  clearL1();
});
afterEach(() => {
  outagesFeed.stop();
  attackOriginsFeed.stop();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  setStore(undefined);
});

const cfRows = (items: { source: string }[] = []) => items.filter((o) => o.source === 'cloudflare');

describe('outages: Cloudflare rows after COMMERCIAL_DEPLOYMENT is switched on', () => {
  it('drops the cached Cloudflare rows and reports cloudflare skipped licence, even when IODA fails', async () => {
    setStore(new MemoryStore());
    state.routes = [['api.ioda.inetintel.cc.gatech.edu', FX.ioda], ['api.cloudflare.com/client/v4/radar/annotations/outages', CF_OUTAGES]];
    const first = await (await GET(req('/api/outages'), undefined)).json();
    expect(cfRows(first.items).length).toBeGreaterThan(0); // control
    expect(first.providers.cloudflare).toMatchObject({ ok: true });

    // Restart on the same store, commercial, and IODA down: the last-good snapshot holds Cloudflare rows.
    outagesFeed.stop();
    clearL1();
    vi.stubEnv('COMMERCIAL_DEPLOYMENT', 'true');
    state.routes = [];
    state.calls.length = 0;
    const down = await GET(req('/api/outages'), undefined);
    const body = await down.json();
    expect(cfRows(body.items)).toEqual([]);
    expect(down.status).toBe(503); // nothing admissible: SOURCE OFFLINE, not the old rows

    vi.setSystemTime(T0 + 6 * 60_000);
    const later = await (await GET(req('/api/outages'), undefined)).json();
    expect(cfRows(later.items)).toEqual([]);

    // IODA back: IODA rows only, Cloudflare skipped for the licence.
    state.routes = [['api.ioda.inetintel.cc.gatech.edu', FX.ioda]];
    vi.setSystemTime(T0 + 8 * 60_000);
    await outagesFeed.refresh({ force: true });
    const back = await (await GET(req('/api/outages'), undefined)).json();
    expect(back.items.length).toBeGreaterThan(0);
    expect(cfRows(back.items)).toEqual([]);
    expect(back.providers.cloudflare).toMatchObject({ ok: false, skipped: 'licence' });
    expect(state.calls.filter((c) => c.url.includes('api.cloudflare.com'))).toEqual([]);
  });
});

describe('Cloudflare skip reason (round-10 MINOR)', () => {
  it("is 'licence' with a token on a commercial deployment, 'not-configured' without a token", async () => {
    vi.stubEnv('COMMERCIAL_DEPLOYMENT', 'true');
    expect(skipReason('cloudflare')).toBe('licence');
    const gated = capabilityGate('cloudflare', 'cloudflare');
    expect((await gated!.json()).providers.cloudflare).toMatchObject({ skipped: 'licence' });
    vi.stubEnv('CLOUDFLARE_API_TOKEN', '');
    expect(skipReason('cloudflare')).toBe('not-configured');
    vi.stubEnv('COMMERCIAL_DEPLOYMENT', '');
    expect(skipReason('cloudflare')).toBe('not-configured');
  });

  it('the attack-origins feed reports a commercial deployment as skipped licence', async () => {
    setStore(new MemoryStore());
    vi.stubEnv('COMMERCIAL_DEPLOYMENT', 'true');
    const r = await attackOriginsFeed.get({ waitForFresh: true });
    expect(r.data).toBeNull();
    expect(r.providers.cloudflare).toMatchObject({ ok: false, skipped: 'licence' });
  });
});
