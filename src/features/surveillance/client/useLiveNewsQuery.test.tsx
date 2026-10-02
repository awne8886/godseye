// @vitest-environment jsdom
/**
 * Verification round 8 (MINOR): a non-503 HTTP failure of /api/live-news (a 502 from the reverse
 * proxy with an HTML body) resolved as `{ok: false, body: {}}`, which replaced the retained good
 * data: the layer went OFFLINE with `lastGoodAt: null` and dropped its dots. Such failures now
 * throw, so react-query keeps the previous answer and the layer shows it at most STALE. The app's
 * own SOURCE OFFLINE 503 (with a feed `meta`) still resolves as `{ok: false}`.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedMeta, LiveNewsResponse } from '@/lib/types';
import { CHANNELS, toChannel } from '../server/live-news';
import { lastFetchFailed } from './refetch-state';
import { fetchLiveNews, useLiveNewsQuery } from './useLiveNewsQuery';

const T1 = '2026-10-02T08:00:00.000Z';
const meta = (state: FeedMeta['state'], lastGoodAt: string | null): FeedMeta => ({
  feed: 'live-news',
  kind: 'live',
  state,
  fetchedAt: lastGoodAt,
  observedAt: null,
  lastGoodAt,
  stale: false,
  ttlSeconds: 3600,
  attribution: [],
});
const good = { items: CHANNELS.slice(0, 3).map((c) => toChannel(c, null)), meta: meta('live', T1), providers: {} } as unknown as LiveNewsResponse;
const offline = { error: 'source_offline', meta: meta('offline', T1), providers: {} };

let next: () => Response;
const jsonRes = (b: unknown, status: number) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const htmlRes = (status: number) => new Response('<html>Bad Gateway</html>', { status, headers: { 'content-type': 'text/html' } });

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(next())));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('fetchLiveNews', () => {
  it('200 resolves ok; the app\'s own 503 SOURCE OFFLINE resolves not-ok with its last-good time', async () => {
    next = () => jsonRes(good, 200);
    expect(await fetchLiveNews()).toMatchObject({ ok: true, body: { meta: { state: 'live' } } });
    next = () => jsonRes(offline, 503);
    expect(await fetchLiveNews()).toMatchObject({ ok: false, body: { meta: { state: 'offline', lastGoodAt: T1 } } });
  });

  it('a proxy 502/504, a 500 or a body-less 503 throws instead of resolving an empty body', async () => {
    for (const r of [() => htmlRes(502), () => htmlRes(504), () => jsonRes({ error: 'internal' }, 500), () => htmlRes(503)]) {
      next = r;
      await expect(fetchLiveNews()).rejects.toThrow(/HTTP/);
    }
  });
});

describe('useLiveNewsQuery after a proxy 502', () => {
  it('keeps the previous good data (with its last-good time) and flags the failed fetch', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, notifyOnChangeProps: 'all' } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    next = () => jsonRes(good, 200);
    const { result } = renderHook(() => useLiveNewsQuery(true), { wrapper });
    await waitFor(() => expect(result.current.data?.ok).toBe(true));

    next = () => htmlRes(502);
    await act(() => result.current.refetch());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toMatchObject({ ok: true, body: { meta: { lastGoodAt: T1 }, items: good.items } });
    expect(lastFetchFailed(result.current)).toBe(true);
    client.clear();
  });
});
