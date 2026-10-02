// @vitest-environment jsdom
/**
 * Verification round 8 (BLOCKING): a refetch of /api/cctv that fails with anything but a 503 (a
 * 502/500 from the reverse proxy or the app, a network error) throws; react-query keeps the
 * previous data, and the layer status was derived from that data's `meta.state` only, so the
 * camera layer stayed LIVE for as long as the server was unreachable. A region shown from retained
 * data is now at most STALE, with its last-good time and `error: 'unreachable'`, and goes back to
 * LIVE only on a fresh answer. Rows: the recorded Hong Kong TD list (2026-09-30) through the real
 * adapter; every other region answers 503 SOURCE OFFLINE.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toColumnar } from '@/lib/columnar';
import { useLayerStatusStore } from '@/lib/layer-host';
import { CAMERA_FIELDS } from '@/lib/schemas/surveillance';
import type { FeedMeta } from '@/lib/types';
import * as A from '../server/adapters';
import { FX, text } from '../server/__fixtures__';
import { atMostStale, lastFetchFailed, worstState } from './refetch-state';
import { loadedStatus, useCctv, type RegionPayload } from './useCctv';

vi.mock('@/components/hud/hooks', () => ({ useHealth: () => ({ data: { capabilities: {} } }) }));

const { rows } = toColumnar(A.parseHongKong(text(FX.hktd)), CAMERA_FIELDS);
const T1 = '2026-10-02T08:00:00.000Z';
const T2 = '2026-10-02T08:30:00.000Z';
const ATTR = [{ text: 'Traffic snapshots: Transport Department, HKSAR Government', url: 'https://data.gov.hk/en/terms-and-conditions' }];

const meta = (fetchedAt: string, state: FeedMeta['state'] = 'live'): FeedMeta => ({
  feed: 'cctv',
  kind: 'live',
  state,
  fetchedAt,
  observedAt: null,
  lastGoodAt: fetchedAt,
  stale: false,
  ttlSeconds: 1800,
  attribution: ATTR,
});
const payload = (fetchedAt: string): RegionPayload => ({
  fields: [...CAMERA_FIELDS],
  rows,
  pendingRegions: [],
  meta: meta(fetchedAt),
  providers: { hktd: { ok: true, count: rows.length, ms: 120, age_s: 0 } },
});

/** What the asia region answers next: a payload, an HTTP status, or a network error. */
let asia: { kind: 'ok'; at: string } | { kind: 'status'; status: number } | { kind: 'network' } = { kind: 'ok', at: T1 };

function respond(url: string): Promise<Response> {
  const region = new URL(url, 'http://localhost').searchParams.get('region');
  if (region !== 'asia') {
    const body = { error: 'source_offline', detail: 'No camera provider answered for these regions.', pendingRegions: [], meta: { ...meta(T1, 'offline'), fetchedAt: null, lastGoodAt: null }, providers: {} };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 503, headers: { 'content-type': 'application/json' } }));
  }
  if (asia.kind === 'network') return Promise.reject(new TypeError('Failed to fetch'));
  if (asia.kind === 'status') return Promise.resolve(new Response('<html>Bad Gateway</html>', { status: asia.status, headers: { 'content-type': 'text/html' } }));
  return Promise.resolve(new Response(JSON.stringify(payload(asia.at)), { status: 200, headers: { 'content-type': 'application/json' } }));
}

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const status = () => useLayerStatusStore.getState().status.cctv;
const refetchAsia = () => act(() => void client.refetchQueries({ queryKey: ['cctv', 'asia'] }));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  client = new QueryClient();
  asia = { kind: 'ok', at: T1 };
  useLayerStatusStore.setState({ status: {} });
  vi.stubGlobal('fetch', vi.fn((u: string) => respond(u)));
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function loadedLive() {
  const hook = renderHook(() => useCctv(true), { wrapper });
  await waitFor(() => expect(status()?.state).toBe('live'));
  expect(status()).toMatchObject({ count: rows.length, fetchedAt: T1, lastGoodAt: T1, error: undefined });
  return hook;
}

describe('useCctv: a failed refetch with retained rows is never LIVE', () => {
  it('200 then 502: STALE with the last-good time while retrying and after the retries give up; rows kept', async () => {
    const { result } = await loadedLive();
    asia = { kind: 'status', status: 502 };
    refetchAsia();
    // First failed attempt (a retry is scheduled 15 s later): already not LIVE.
    await waitFor(() => expect(status()?.state).toBe('stale'));
    expect(status()).toMatchObject({ lastGoodAt: T1, fetchedAt: T1, error: 'unreachable', count: rows.length });
    expect(result.current?.rows.length).toBe(rows.length);
    // Retries exhausted (15 + 30 + 45 s): react-query is in error with the old data.
    await act(() => vi.advanceTimersByTimeAsync(100_000));
    await waitFor(() => expect(client.getQueryState(['cctv', 'asia'])?.status).toBe('error'));
    expect(status()).toMatchObject({ state: 'stale', lastGoodAt: T1, error: 'unreachable' });
    expect(result.current?.rows.length).toBe(rows.length);
  });

  it('a network error (TypeError) is handled the same way', async () => {
    await loadedLive();
    asia = { kind: 'network' };
    refetchAsia();
    await waitFor(() => expect(status()?.state).toBe('stale'));
    expect(status()).toMatchObject({ lastGoodAt: T1, error: 'unreachable' });
  });

  it('a 500 is not LIVE either, and a fresh answer after the retries gave up restores LIVE', async () => {
    await loadedLive();
    asia = { kind: 'status', status: 500 };
    refetchAsia();
    await waitFor(() => expect(status()?.state).toBe('stale'));
    await act(() => vi.advanceTimersByTimeAsync(100_000));
    asia = { kind: 'ok', at: T2 };
    refetchAsia();
    await waitFor(() => expect(status()?.state).toBe('live'));
    expect(status()).toMatchObject({ fetchedAt: T2, lastGoodAt: T2, error: undefined });
  });
});

describe('refetch-state helpers', () => {
  it('atMostStale never makes a state fresher', () => {
    expect(atMostStale('live')).toBe('stale');
    expect(atMostStale('recent')).toBe('stale');
    expect(atMostStale('reference')).toBe('stale');
    expect(atMostStale('stale')).toBe('stale');
    expect(atMostStale('offline')).toBe('offline');
    expect(worstState(['live', 'recent', 'stale'])).toBe('stale');
    expect(worstState([])).toBe('live');
  });

  it('lastFetchFailed needs retained data and a failure', () => {
    expect(lastFetchFailed({ data: undefined, isError: true, failureCount: 1 })).toBe(false);
    expect(lastFetchFailed({ data: {}, isError: false, failureCount: 0 })).toBe(false);
    expect(lastFetchFailed({ data: {}, isError: false, failureCount: 1 })).toBe(true);
    expect(lastFetchFailed({ data: {}, isError: true, failureCount: 0 })).toBe(true);
  });

  it('loadedStatus: the stalest region wins and a failed region caps the layer at STALE', () => {
    const fresh = { body: payload(T2), refetchFailed: false };
    const failed = { body: payload(T1), refetchFailed: true };
    expect(loadedStatus([fresh], 3, {})).toMatchObject({ state: 'live', lastGoodAt: T2, error: undefined });
    expect(loadedStatus([fresh, failed], 6, {})).toMatchObject({ state: 'stale', fetchedAt: T1, lastGoodAt: T1, error: 'unreachable', count: 6 });
    expect(loadedStatus([fresh, failed], 6, {}).attribution).toHaveLength(1);
  });
});
