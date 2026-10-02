// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLayerStatusStore } from '@/lib/layer-host';
import * as S from '@/lib/schemas/common';
import type { Earthquake, EarthquakesResponse, FeedMeta } from '@/lib/types';
import { FX, fixtureJson } from '../server/__fixtures__';
import { normalizeUsgs, type UsgsCollection } from '../server/usgs-parse';
import { hazardStatus, loadHazard, useHazardData, type HazardResult } from './useHazardData';

/** The QueryClient defaults of src/app/providers.tsx (retry 2, background polling paused). */
const appClient = () =>
  new QueryClient({ defaultOptions: { queries: { refetchIntervalInBackground: false, refetchOnWindowFocus: false, retry: 2, staleTime: 10_000 } } });

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}
const wrapper = wrapperFor(new QueryClient({ defaultOptions: { queries: { retry: false } } }));

beforeEach(() => {
  useLayerStatusStore.setState({ status: {} });
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no network in unit tests'))));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  focusManager.setFocused(undefined);
});

describe('useHazardData idle state (R2 minor 1)', () => {
  it('publishes idle with the zoom reason, not ACQUIRING/loading, while nothing is fetched', () => {
    renderHook(() => useHazardData('sentinel', null, () => 0, 'zoom_min_6'), { wrapper });
    expect(useLayerStatusStore.getState().status.sentinel).toMatchObject({ state: 'idle', count: null, error: 'zoom_min_6' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('goes back to idle with the reason when the url is cleared after a fetch', () => {
    const { rerender } = renderHook(({ url }: { url: string | null }) => useHazardData('sentinel', url, () => 0, 'zoom_min_6'), { wrapper, initialProps: { url: '/api/sentinel?lat=1&lng=2' as string | null } });
    expect(useLayerStatusStore.getState().status.sentinel?.state).toBe('loading');
    rerender({ url: null });
    expect(useLayerStatusStore.getState().status.sentinel).toMatchObject({ state: 'idle', error: 'zoom_min_6' });
  });
});

// ── Round 8 BLOCKING: a refresh that fails with anything but the app's 503 kept LIVE forever ─────
// Recorded USGS 2.5_day payload through the real parser, wrapped in the envelope feedJson serves
// (meta validated against the FeedMeta contract).
const T0 = Date.parse('2026-09-30T12:00:00Z');
const REFRESH = 60_000; // earthquakes refreshMs in the layer registry
const quakes: Earthquake[] = normalizeUsgs(fixtureJson<UsgsCollection>(FX.usgs));
/** Newest origin time in the recording, as the server's newestObservation() reports it. */
const newest = quakes.map((q) => q.observedAt).filter((t): t is string => t !== null).sort().at(-1) ?? null;
const meta = (over: Partial<FeedMeta> = {}): FeedMeta =>
  S.FeedMeta.parse({
    feed: 'earthquakes:2.5_day',
    kind: 'live',
    state: 'live',
    fetchedAt: new Date(T0 - 20_000).toISOString(),
    observedAt: newest,
    lastGoodAt: new Date(T0 - 20_000).toISOString(),
    stale: false,
    ttlSeconds: 60,
    attribution: [{ text: 'Earthquakes: U.S. Geological Survey (USGS) Earthquake Hazards Program', url: 'https://earthquake.usgs.gov/earthquakes/feed/', licence: 'Public domain' }],
    ...over,
  });
const providers = { usgs: { ok: true, count: quakes.length, ms: 430, age_s: 20 } };
const live = { items: quakes, meta: meta(), providers };
const offline503 = { error: 'source_offline', detail: 'No data from earthquakes upstreams yet.', meta: meta({ state: 'offline', fetchedAt: null, observedAt: null, lastGoodAt: null, stale: true }), providers: { usgs: { ok: false, count: 0, ms: 20000, age_s: null } } };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const proxyError = (status: number) => new Response('<html><body>502 Bad Gateway</body></html>', { status, headers: { 'content-type': 'text/html' } });

type Reply = () => Promise<Response>;
/** fetch answers with `reply` until it is swapped; every call is counted. */
function upstream(first: Reply) {
  let reply = first;
  const fn = vi.fn(() => reply());
  vi.stubGlobal('fetch', fn);
  return { fn, set: (r: Reply) => void (reply = r) };
}

const status = () => useLayerStatusStore.getState().status.earthquakes!;
const count = (b: EarthquakesResponse) => b.items.length;

/** Mounts the earthquakes hook with the app's query defaults and fake timers (Date included). */
async function mountEarthquakes() {
  vi.useFakeTimers({ now: T0 });
  focusManager.setFocused(true);
  const seen: string[] = [];
  const unsub = useLayerStatusStore.subscribe((s) => void seen.push(s.status.earthquakes?.state ?? 'none'));
  const view = renderHook(() => useHazardData<EarthquakesResponse>('earthquakes', '/api/earthquakes', count), { wrapper: wrapperFor(appClient()) });
  await act(() => vi.advanceTimersByTimeAsync(0));
  return { view, seen, unsub };
}
/** Lets the refetch interval (and react-query's 1 s / 2 s retries) run for `ms`. */
const elapse = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

describe('useHazardData never stays LIVE when refreshes fail (round 8 BLOCKING)', () => {
  it('a 200 then 502s → STALE with the retained last-good/fetched times, then SOURCE OFFLINE and cleared after 6 × refresh', async () => {
    const up = upstream(async () => json(live));
    const { view, seen, unsub } = await mountEarthquakes();
    expect(status()).toMatchObject({ state: 'live', count: quakes.length, error: undefined });
    expect(view.result.current?.items).toHaveLength(quakes.length);

    up.set(async () => proxyError(502));
    await elapse(REFRESH + 3_000 + 100); // next poll + both retries
    expect(up.fn.mock.calls.length).toBe(1 + 3);
    expect(status()).toMatchObject({
      state: 'stale',
      count: quakes.length,
      error: 'unreachable',
      fetchedAt: live.meta.fetchedAt,
      lastGoodAt: live.meta.lastGoodAt,
      observedAt: live.meta.observedAt,
    });
    // Still drawn (badged STALE), never LIVE after the first failure.
    expect(view.result.current?.items).toHaveLength(quakes.length);
    const firstFailure = seen.lastIndexOf('live');

    // The probe scenario: still failing four minutes later → still not LIVE.
    await elapse(3 * REFRESH);
    expect(status().state).toBe('stale');

    // Past 6 × the interval without one good refresh: SOURCE OFFLINE, cleared, last-good time kept.
    await elapse(3 * REFRESH);
    expect(status()).toMatchObject({ state: 'offline', count: null, error: 'unreachable', lastGoodAt: live.meta.lastGoodAt });
    expect(view.result.current).toBeNull();
    expect(seen.slice(firstFailure + 1)).not.toContain('live');

    // A good refresh brings it straight back.
    up.set(async () => json({ ...live, meta: meta({ fetchedAt: new Date(T0 + 7 * REFRESH).toISOString(), lastGoodAt: new Date(T0 + 7 * REFRESH).toISOString() }) }));
    await elapse(REFRESH);
    expect(status()).toMatchObject({ state: 'live', count: quakes.length, error: undefined });
    expect(view.result.current?.items).toHaveLength(quakes.length);
    unsub();
  });

  it('a 200 then network errors (fetch rejects) → STALE, not LIVE', async () => {
    const up = upstream(async () => json(live));
    const { unsub } = await mountEarthquakes();
    expect(status().state).toBe('live');
    up.set(() => Promise.reject(new TypeError('Failed to fetch')));
    await elapse(REFRESH + 3_100);
    expect(status()).toMatchObject({ state: 'stale', error: 'unreachable', lastGoodAt: live.meta.lastGoodAt });
    unsub();
  });

  it('a 200 then a 500 from the app → STALE', async () => {
    const up = upstream(async () => json(live));
    const { unsub } = await mountEarthquakes();
    up.set(async () => json({ error: 'internal' }, 500));
    await elapse(REFRESH + 3_100);
    expect(status()).toMatchObject({ state: 'stale', error: 'unreachable' });
    unsub();
  });

  it('a bare 503 from a reverse proxy (no envelope) is a failure: STALE, last-good time not wiped', async () => {
    const up = upstream(async () => json(live));
    const { unsub } = await mountEarthquakes();
    up.set(async () => proxyError(503));
    await elapse(REFRESH + 3_100);
    expect(status()).toMatchObject({ state: 'stale', error: 'unreachable', lastGoodAt: live.meta.lastGoodAt, fetchedAt: live.meta.fetchedAt });
    unsub();
  });

  it('a 200 whose body is not a feed envelope (captive portal) is a failure, not a crash or LIVE', async () => {
    const up = upstream(async () => json(live));
    const { unsub } = await mountEarthquakes();
    up.set(async () => new Response('<html>Sign in to Wi-Fi</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    await elapse(REFRESH + 3_100);
    expect(status()).toMatchObject({ state: 'stale', error: 'unreachable' });
    unsub();
  });

  it("the app's 503 envelope then a network error → SOURCE OFFLINE (unreachable), the 503's times kept", async () => {
    const lastGood = new Date(T0 - 3_600_000).toISOString();
    const up = upstream(async () => json({ ...offline503, meta: { ...offline503.meta, lastGoodAt: lastGood } }, 503));
    const { view, unsub } = await mountEarthquakes();
    expect(status()).toMatchObject({ state: 'offline', error: 'source_offline', lastGoodAt: lastGood });
    up.set(() => Promise.reject(new TypeError('Failed to fetch')));
    await elapse(REFRESH + 3_100);
    expect(status()).toMatchObject({ state: 'offline', count: null, error: 'unreachable', lastGoodAt: lastGood });
    expect(view.result.current).toBeNull();
    unsub();
  });

  it('nothing ever received and the fetch fails → SOURCE OFFLINE (unreachable)', async () => {
    upstream(() => Promise.reject(new TypeError('Failed to fetch')));
    const { view, unsub } = await mountEarthquakes();
    await elapse(3_100);
    expect(status()).toMatchObject({ state: 'offline', count: null, error: 'unreachable' });
    expect(view.result.current).toBeNull();
    unsub();
  });

  it('a snapshot not refreshed because the tab is hidden leaves LIVE after 2 × refresh, then STALE after 6 ×', async () => {
    const up = upstream(async () => json(live));
    const { view, unsub } = await mountEarthquakes();
    expect(status().state).toBe('live');
    focusManager.setFocused(false); // refetchIntervalInBackground: false → polls are skipped
    await elapse(2 * REFRESH - 1_000);
    expect(status().state).toBe('live');
    await elapse(2_000);
    expect(status()).toMatchObject({ state: 'recent', count: quakes.length, fetchedAt: live.meta.fetchedAt });
    await elapse(4 * REFRESH);
    expect(status().state).toBe('stale');
    expect(up.fn).toHaveBeenCalledTimes(1);
    expect(view.result.current?.items).toHaveLength(quakes.length); // only a failure clears the layer
    unsub();
  });
});

describe('loadHazard', () => {
  it('turns a request that never answers into a TimeoutError instead of a query that never settles', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason)))),
    );
    await expect(loadHazard('/api/earthquakes', new AbortController().signal, 30)).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it("forwards react-query's cancellation to the request", async () => {
    let seen: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        seen = init.signal!;
        return new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
      }),
    );
    const ac = new AbortController();
    const p = loadHazard('/api/earthquakes', ac.signal, 60_000);
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(seen?.aborted).toBe(true);
  });

  it("keeps the app's 503 envelope as SOURCE OFFLINE and rejects a bare 503", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(offline503, 503)));
    await expect(loadHazard('/api/earthquakes', new AbortController().signal)).resolves.toMatchObject({ ok: false, body: { error: 'source_offline' } });
    vi.stubGlobal('fetch', vi.fn(async () => proxyError(503)));
    await expect(loadHazard('/api/earthquakes', new AbortController().signal)).rejects.toThrow('HTTP 503');
  });
});

describe('hazardStatus (pure)', () => {
  const ok: HazardResult<EarthquakesResponse> = { ok: true, body: live, receivedAt: T0 };
  it('server state while the snapshot is fresh, its age past 2 × refresh, STALE past 6 ×; re-check times', () => {
    expect(hazardStatus({ result: ok, failedAt: null, refreshMs: REFRESH }, count, T0 + 1_000)).toMatchObject({ patch: { state: 'live' }, recheckAt: T0 + 2 * REFRESH + 1 });
    expect(hazardStatus({ result: ok, failedAt: null, refreshMs: REFRESH }, count, T0 + 2 * REFRESH + 1)).toMatchObject({ patch: { state: 'recent' }, recheckAt: T0 + 6 * REFRESH + 1 });
    expect(hazardStatus({ result: ok, failedAt: null, refreshMs: REFRESH }, count, T0 + 6 * REFRESH + 1)).toMatchObject({ patch: { state: 'stale' }, recheckAt: null });
  });
  it('never improves on the server state (a STALE snapshot stays STALE)', () => {
    const stale = { ...ok, body: { ...live, meta: meta({ state: 'stale', stale: true }) } };
    expect(hazardStatus({ result: stale, failedAt: null, refreshMs: REFRESH }, count, T0)).toMatchObject({ patch: { state: 'stale' }, recheckAt: null });
    expect(hazardStatus({ result: stale, failedAt: T0 + REFRESH, refreshMs: REFRESH }, count, T0 + REFRESH).patch?.state).toBe('stale');
  });
  it('a failed refresh is judged at the failure time, never LIVE', () => {
    expect(hazardStatus({ result: ok, failedAt: T0 + REFRESH, refreshMs: REFRESH }, count, T0 + REFRESH).patch).toMatchObject({ state: 'stale', error: 'unreachable', count: quakes.length });
    expect(hazardStatus({ result: ok, failedAt: T0 + 6 * REFRESH + 1, refreshMs: REFRESH }, count, T0 + 6 * REFRESH + 1).patch).toMatchObject({ state: 'offline', count: null });
  });
});
