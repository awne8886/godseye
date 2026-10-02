// @vitest-environment jsdom
/**
 * Verification round 10 BLOCKING 1: `if (failed && !result)` reported SOURCE OFFLINE only when no
 * answer was held. A refetch that failed with a 502/500/network error kept react-query's previous
 * body, and the row kept that body's meta.state: 'Internet Outages: LIVE' at t+330 s and t+420 s
 * with /api/outages answering 502 since the first load. A failing refresh is now never LIVE: the
 * retained answer is STALE with its own last-good time, SOURCE OFFLINE ('unreachable') after 2 ×
 * the poll interval. Envelopes are validated against the FeedMeta contract; no network.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLayerStatusStore, type LayerStatus } from '@/lib/layer-host';
import * as S from '@/lib/schemas/common';
import type { FeedMeta } from '@/lib/types';
import { feedStatus, refreshMsFor, useFeedData } from './hooks';

const REFRESH = refreshMsFor('cf_outages')!; // 5 min in the layer registry
const T0 = Date.parse('2026-10-02T12:00:00Z');
const meta = (over: Partial<FeedMeta> = {}): FeedMeta =>
  S.FeedMeta.parse({
    feed: 'outages',
    kind: 'live',
    state: 'live',
    fetchedAt: new Date(T0 - 10_000).toISOString(),
    observedAt: new Date(T0 - 60_000).toISOString(),
    lastGoodAt: new Date(T0 - 10_000).toISOString(),
    stale: false,
    ttlSeconds: 300,
    attribution: [{ text: 'Internet outages: IODA (Georgia Tech)', url: 'https://ioda.inetintel.cc.gatech.edu/' }],
    ...over,
  });
type Body = { items: { id: string }[] };
const live = { items: [{ id: 'ioda:1' }, { id: 'ioda:2' }, { id: 'ioda:3' }], meta: meta(), providers: { ioda: { ok: true, count: 3, ms: 210, age_s: 10 } } };
const count = (b: Body) => b.items.length;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const proxyError = (status: number) => new Response('<html><body>Bad Gateway</body></html>', { status, headers: { 'content-type': 'text/html' } });

/** The app's QueryClient defaults (src/app/providers.tsx: retry 2, background polling paused). */
const appClient = () => new QueryClient({ defaultOptions: { queries: { refetchIntervalInBackground: false, refetchOnWindowFocus: false, retry: 2, staleTime: 10_000 } } });
const wrapperFor = (client: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const row = () => useLayerStatusStore.getState().status.cf_outages;

/** Every state the row takes from now on. */
function recordStates(): LayerStatus['state'][] {
  const seen: LayerStatus['state'][] = [];
  useLayerStatusStore.subscribe((s) => {
    const st = s.status.cf_outages?.state;
    if (st && seen.at(-1) !== st) seen.push(st);
  });
  return seen;
}

let reply: () => Response = () => json(live);
beforeEach(() => {
  useLayerStatusStore.setState({ status: {} });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'], now: T0 });
  reply = () => json(live);
  vi.stubGlobal('fetch', vi.fn(async () => reply()));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useFeedData: a failed refetch is never LIVE (round 10 BLOCKING 1)', () => {
  it.each([502, 500])('200 then %i: STALE with the retained last-good time, SOURCE OFFLINE after 2 × refreshMs', async (status) => {
    const hook = renderHook(() => useFeedData<Body>('cf_outages', '/api/outages', count), { wrapper: wrapperFor(appClient()) });
    await advance(1_000);
    expect(row()).toMatchObject({ state: 'live', count: 3, error: undefined });
    reply = () => proxyError(status);
    const states = recordStates();
    // Next poll fails; react-query retries twice (1 s, 2 s back-off) and keeps the 200 body.
    await advance(REFRESH + 500);
    expect(row()).toMatchObject({ state: 'stale', count: 3, lastGoodAt: live.meta.lastGoodAt, fetchedAt: live.meta.fetchedAt });
    expect(hook.result.current?.items).toHaveLength(3);
    await advance(10_000);
    expect(row()).toMatchObject({ state: 'stale', error: 'unreachable', lastGoodAt: live.meta.lastGoodAt });
    // The verifier's samples (t+330 s, t+420 s) and beyond: never LIVE.
    await advance(330_000 - REFRESH - 10_500);
    expect(row()?.state).not.toBe('live');
    await advance(REFRESH + 1_000);
    expect(row()).toMatchObject({ state: 'offline', count: null, error: 'unreachable', lastGoodAt: live.meta.lastGoodAt, fetchedAt: live.meta.fetchedAt });
    expect(hook.result.current).toBeNull();
    expect(states).not.toContain('live');
    expect(states).toEqual(['stale', 'offline']);
  });

  it('a network error with no answer yet is SOURCE OFFLINE (unreachable), not ACQUIRING forever', async () => {
    reply = () => {
      throw new TypeError('Failed to fetch');
    };
    renderHook(() => useFeedData<Body>('cf_outages', '/api/outages', count), { wrapper: wrapperFor(appClient()) });
    await advance(500);
    expect(row()?.state).toBe('loading');
    await advance(10_000);
    expect(row()).toMatchObject({ state: 'offline', count: null, error: 'unreachable' });
  });

  it('a bare proxy 503 (no envelope) is a failure that keeps the last-good time, not SOURCE OFFLINE with none', async () => {
    renderHook(() => useFeedData<Body>('cf_outages', '/api/outages', count), { wrapper: wrapperFor(appClient()) });
    await advance(1_000);
    reply = () => proxyError(503);
    await advance(REFRESH + 10_000);
    expect(row()).toMatchObject({ state: 'stale', count: 3, lastGoodAt: live.meta.lastGoodAt, error: 'unreachable' });
  });

  it("the server's own 503 envelope is SOURCE OFFLINE with its last-good time", async () => {
    renderHook(() => useFeedData<Body>('cf_outages', '/api/outages', count), { wrapper: wrapperFor(appClient()) });
    await advance(1_000);
    const lastGood = meta({ state: 'offline', stale: true });
    reply = () => json({ error: 'source_offline', meta: lastGood, providers: { ioda: { ok: false, count: 0, ms: 20000, age_s: null } } }, 503);
    await advance(REFRESH + 500);
    expect(row()).toMatchObject({ state: 'offline', count: null, error: 'source_offline', lastGoodAt: lastGood.lastGoodAt });
  });

  it('recovers to the served state when the route answers again', async () => {
    renderHook(() => useFeedData<Body>('cf_outages', '/api/outages', count), { wrapper: wrapperFor(appClient()) });
    await advance(1_000);
    reply = () => proxyError(502);
    await advance(REFRESH + 10_000);
    expect(row()?.state).toBe('stale');
    reply = () => json(live);
    await advance(REFRESH);
    expect(row()).toMatchObject({ state: 'live', count: 3, error: undefined });
  });

  it('feedStatus: a failing retained answer is never fresher than STALE and keeps a worse server state', () => {
    const ok = { ok: true as const, body: live, receivedAt: T0 };
    expect(feedStatus(ok, true, count, REFRESH, T0 + 1).patch?.state).toBe('stale');
    const old = { ...ok, body: { ...live, meta: meta({ state: 'offline' }) } };
    expect(feedStatus(old, true, count, REFRESH, T0 + 1).patch?.state).toBe('offline');
    expect(feedStatus(ok, true, count, REFRESH, T0 + 2 * REFRESH + 1)).toMatchObject({ patch: { state: 'offline', error: 'unreachable' }, body: null });
    expect(feedStatus(ok, true, count, null, T0 + 100 * REFRESH).patch?.state).toBe('stale');
    expect(feedStatus(ok, false, count, REFRESH, T0 + 1).patch?.state).toBe('live');
  });
});
