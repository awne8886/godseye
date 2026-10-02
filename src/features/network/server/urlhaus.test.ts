/**
 * Verification round 10 BLOCKING 2: when the URLhaus CSV failed, malwareFeed.run diffed `items = []`
 * against the last-good set and broadcast every IP as retired ('BROADCAST status retired=182
 * total=0'); the cache kept the 182 hosts but every SSE client emptied its map and its row stayed
 * LIVE, and a following 304 sent nothing. A failed run (CSV error, no rows, nothing geolocated)
 * now retires nothing and broadcasts a degraded status with the last-good time; the next good run
 * (or 304) broadcasts the served total so clients recover. Recorded URLhaus CSV; ip-api answered
 * by a scripted batch reply; no network.
 */
import type * as Http from '@/lib/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FX, type Route } from '@/features/threats/server/__fixtures__';
import { freshCache, resetCache } from '@/features/threats/server/__fixtures__/routes';
import type { MalwareStatus } from '../client/malware-state';
import { resetIpGeo } from './ipgeo';
import { malwareFeed, malwareHub } from './urlhaus';

const state = vi.hoisted(() => ({ routes: [] as Route[] }));
vi.mock('@/lib/http', async (importOriginal) => {
  const orig = await importOriginal<typeof Http>();
  const { httpMock } = await import('@/features/threats/server/__fixtures__');
  return { ...orig, ...httpMock(() => state.routes, orig.HttpError) };
});

const ipapi = (_url: string, opts: { body?: string | Buffer }) =>
  Buffer.from(JSON.stringify((JSON.parse(String(opts.body)) as string[]).map((q) => ({ status: 'success', query: q, country: 'Testland', city: 'Town', lat: 10, lon: 20 }))));
const ipapiDown = () => 503;

let sent: { event: string; data: unknown }[] = [];
const statuses = () => sent.filter((s) => s.event === 'status').map((s) => s.data as MalwareStatus);

beforeEach(() => {
  // The recording's capture time (its Last-Modified): its newest rows are minutes old, so LIVE.
  vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-09-30T20:00:00Z') });
  freshCache();
  resetIpGeo();
  sent = [];
  vi.spyOn(malwareHub(), 'broadcast').mockImplementation((event: string, data: unknown) => {
    sent.push({ event, data });
    return 0;
  });
});
afterEach(() => {
  malwareFeed.stop();
  resetCache();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function goodRun() {
  state.routes = [['csv_recent', FX.urlhaus], ['ip-api.com/batch', ipapi]];
  const r = await malwareFeed.refresh({ force: true });
  expect(r.data?.items.length).toBeGreaterThan(50);
  expect(r.meta.state).toBe('live');
  return r;
}

describe('malwareFeed: a failed URLhaus run never retires the served hosts (round 10 BLOCKING 2)', () => {
  it.each([
    ['the CSV answers 503', () => [['csv_recent', 503]] as Route[], 'urlhaus_unavailable'],
    ['the CSV has no rows', () => [['csv_recent', Buffer.from('# URLhaus header only\n')]] as Route[], 'urlhaus_unavailable'],
    ['geolocation located nothing', () => [['csv_recent', FX.urlhaus], ['ip-api.com/batch', ipapiDown]] as Route[], 'geolocation_unavailable'],
  ])('%s after a good run: no retirements, a STALE notice with the last-good time, the hosts still served', async (_label, routes, error) => {
    const good = await goodRun();
    const total = good.data!.items.length;
    resetIpGeo();
    sent = [];
    state.routes = routes();
    const r = await malwareFeed.refresh({ force: true });
    // The cache keeps the last-good set; its meta is degraded, never LIVE.
    expect(r.data?.items).toHaveLength(total);
    expect(r.meta.state).not.toBe('live');
    expect(r.meta.lastGoodAt).toBe(good.meta.lastGoodAt);
    expect(sent.filter((s) => s.event === 'detections')).toEqual([]);
    expect(statuses()).toEqual([{ retired: [], state: 'stale', lastGoodAt: good.meta.lastGoodAt, error, at: expect.any(String) }]);
    // The snapshot a (re)connecting client receives is the same last-good set.
    const snap = malwareFeed.peek();
    expect(snap.data?.items).toHaveLength(total);
  });

  it('recovery: the next good run broadcasts the served total (clients resync), a 304 too', async () => {
    const good = await goodRun();
    const total = good.data!.items.length;
    state.routes = [['csv_recent', 503]];
    await malwareFeed.refresh({ force: true });
    sent = [];
    // Unchanged list after the outage: nothing new, nothing retired, but the recovery is announced.
    await goodRun();
    expect(statuses()).toEqual([{ retired: [], total, state: 'live', fetchedAt: expect.any(String), lastGoodAt: expect.any(String), at: expect.any(String) }]);
    // Steady state: an unchanged good run announces nothing.
    sent = [];
    await goodRun();
    expect(sent).toEqual([]);
    // Outage, then the CSV revalidates with a 304: recovery is announced with the held total.
    state.routes = [['csv_recent', 503]];
    await malwareFeed.refresh({ force: true });
    sent = [];
    state.routes = [['csv_recent', 304], ['ip-api.com/batch', ipapi]];
    await malwareFeed.refresh({ force: true });
    expect(statuses()).toEqual([expect.objectContaining({ retired: [], total })]);
  });

  it('a cold failure (no last-good set) announces SOURCE OFFLINE with no last-good time', async () => {
    state.routes = [['csv_recent', 503]];
    const r = await malwareFeed.refresh({ force: true });
    expect(r.data).toBeNull();
    expect(statuses()).toEqual([{ retired: [], state: 'offline', lastGoodAt: null, error: 'urlhaus_unavailable', at: expect.any(String) }]);
  });
});
