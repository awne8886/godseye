/**
 * Phase 3 round 9 MINOR: a conflicts rebuild after GDELT's 15-minute TTL read the previous GDELT
 * snapshot (stale-while-revalidate) and was stamped LIVE one batch behind. The rebuild now awaits the
 * GDELT refresh, and falls back to the last-good snapshot when that refresh fails or hangs.
 */
import type * as Http from '@/lib/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newsFeed } from '@/components/panels/intel/feeds';
import { FX, type Route } from '@/features/threats/server/__fixtures__';
import { freshCache, req, resetCache } from '@/features/threats/server/__fixtures__/routes';
import { conflictsFeed, INPUT_WAIT_MS, readFresh, resetConflictBuffer } from '@/features/threats/server/conflicts';
import { gdeltFeed, resetGdeltBatches } from '@/features/threats/server/gdelt';
import { ConflictsResponse } from '@/lib/schemas';
import { GET } from './route';

const state = vi.hoisted(() => ({ routes: [] as Route[] }));
vi.mock('@/lib/http', async (importOriginal) => {
  const orig = await importOriginal<typeof Http>();
  const { httpMock } = await import('@/features/threats/server/__fixtures__');
  return { ...orig, ...httpMock(() => state.routes, orig.HttpError) };
});

const T0 = Date.parse('2026-09-30T20:10:00Z');
const AFTER_TTL = T0 + 20 * 60_000; // past both the GDELT and the conflicts 15-minute TTL
const HEALTHY: Route[] = [['lastupdate.txt', FX.gdeltLast], ['20260930200000.export', FX.gdeltZip], ['.export.CSV.zip', 404]];

beforeEach(() => {
  freshCache();
  resetGdeltBatches();
  resetConflictBuffer();
  vi.useFakeTimers({ now: T0, toFake: ['Date'] });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  gdeltFeed.stop();
  conflictsFeed.stop();
  newsFeed.stop();
  resetCache();
});

async function body() {
  const res = await GET(req('/api/conflicts'), undefined);
  expect(res.status).toBe(200);
  const b = await res.json();
  expect(ConflictsResponse.safeParse(b).success).toBe(true);
  return b;
}

/** Healthy GDELT pull and conflicts build at T0, then the clock moves past both TTLs. */
async function builtThenExpired() {
  state.routes = HEALTHY;
  const first = await body();
  expect(first.providers.gdelt).toMatchObject({ ok: true, age_s: 0 });
  expect(first.events.length).toBeGreaterThan(0);
  vi.setSystemTime(AFTER_TTL);
  expect(gdeltFeed.peek().meta.stale).toBe(true);
  return first;
}

it('a rebuild after the GDELT TTL awaits the GDELT refresh and folds in that pull', async () => {
  await builtThenExpired();
  const r = await conflictsFeed.refresh({ force: true });
  // The GDELT refresh finished before conflicts was built: its pull is the one counted, not T0's.
  expect(gdeltFeed.peek().meta.fetchedAt).toBe(new Date(AFTER_TTL).toISOString());
  expect(r.meta.fetchedAt).toBe(new Date(AFTER_TTL).toISOString());
  expect(r.providers.gdelt).toMatchObject({ ok: true, age_s: 0 });
  expect(r.meta.state).toBe('live');
});

it('falls back to the last-good GDELT snapshot when the refresh fails', async () => {
  const first = await builtThenExpired();
  state.routes = [['lastupdate.txt', 503]];
  const r = await conflictsFeed.refresh({ force: true });
  // The refresh was attempted (and failed) during this rebuild; conflicts still rebuilt from T0's batch.
  expect(gdeltFeed.peek().meta.state).not.toBe('live');
  expect(r.meta.fetchedAt).toBe(new Date(AFTER_TTL).toISOString());
  expect(r.data!.events.length).toBe(first.events.length);
  expect(r.providers.gdelt).toMatchObject({ ok: false, age_s: 1200 });
  expect(r.providers.gdelt!.error).toBeDefined();
  expect(r.meta.state).toBe('recent');
});

describe('a hung GDELT refresh', () => {
  it('is bounded: the rebuild uses the stale snapshot after INPUT_WAIT_MS, within the conflicts deadline', async () => {
    const first = await builtThenExpired();
    const stale = gdeltFeed.peek();
    vi.spyOn(gdeltFeed, 'get').mockReturnValue(new Promise<never>(() => {}));
    vi.spyOn(newsFeed, 'get').mockResolvedValue({ ...newsFeed.peek(), data: { items: [], sources: [] } });
    vi.useFakeTimers({ now: AFTER_TTL, toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    let done = false;
    const p = conflictsFeed.refresh({ force: true }).then((r) => ((done = true), r));
    await vi.advanceTimersByTimeAsync(INPUT_WAIT_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const r = await p;
    expect(gdeltFeed.get).toHaveBeenCalledWith({ waitForFresh: true });
    expect(r.meta.fetchedAt).toBe(new Date(AFTER_TTL + INPUT_WAIT_MS).toISOString());
    expect(r.data!.events.length).toBe(first.events.length);
    // The fallback is the T0 pull, and providers.gdelt reports its true age.
    expect(r.providers.gdelt!.age_s).toBe((AFTER_TTL + INPUT_WAIT_MS - T0) / 1000);
    expect(stale.meta.fetchedAt).toBe(new Date(T0).toISOString());
  });
});

describe('readFresh', () => {
  const snap = { data: 'old', meta: { state: 'stale' } } as unknown as ReturnType<typeof gdeltFeed.peek>;
  const fresh = { data: 'new', meta: { state: 'live' } } as unknown as ReturnType<typeof gdeltFeed.peek>;

  it('returns the refreshed result when it arrives in time', async () => {
    const get = vi.fn().mockResolvedValue(fresh);
    await expect(readFresh({ get, peek: () => snap }, 1000)).resolves.toBe(fresh);
    expect(get).toHaveBeenCalledWith({ waitForFresh: true });
  });

  it('falls back to the current snapshot on timeout, rejection or abort', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const hung = readFresh({ get: () => new Promise<never>(() => {}), peek: () => snap }, 50);
    await vi.advanceTimersByTimeAsync(50);
    await expect(hung).resolves.toBe(snap);
    await expect(readFresh({ get: () => Promise.reject(new Error('x')), peek: () => snap }, 50)).resolves.toBe(snap);
    const ac = new AbortController();
    const aborted = readFresh({ get: () => new Promise<never>(() => {}), peek: () => snap }, 60_000, ac.signal);
    ac.abort();
    await expect(aborted).resolves.toBe(snap);
    ac.abort();
    await expect(readFresh({ get: () => new Promise<never>(() => {}), peek: () => snap }, 60_000, ac.signal)).resolves.toBe(snap);
  });
});
