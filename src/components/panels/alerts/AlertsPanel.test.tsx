// @vitest-environment jsdom
/**
 * r8 MINOR: react-query keeps the last data when a refetch fails. The ALERTS chip used to read the
 * retained copy ("N RESULTS", green) beside the red SOURCE OFFLINE banner, and a network error showed
 * no failure at all. The failure now owns the chip and the banner, for a 503 and for no answer, and a
 * successful refetch restores both (the rail status too, even when the data object is unchanged).
 * Items are built from a recorded t.me/s page (2026-09-30); fetch is stubbed, no network.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstrumentFrame } from '@/components/hud/PanelChrome';
import type { NewsResponse } from '@/lib/types';
import { FX, fixtureText } from '../intel/__fixtures__';
import { FeedOfflineError, NEWS_QUERY_KEY } from '../intel/client';
import { TELEGRAM_CHANNELS, fromTelegram, latestChannelPosts } from '../intel/server/news';
import { alertPinsStatus } from './AlertPinsLayer';
import { AlertsPanel } from './AlertsPanel';

const osint = TELEGRAM_CHANNELS.find((c) => c.handle === 'Osintdefender')!;
const items = latestChannelPosts(fixtureText(FX.tgOsint), 'Osintdefender').map((p) => fromTelegram(p, osint));
const FETCHED = '2026-09-30T20:05:00.000Z';
const good: NewsResponse = {
  meta: { feed: 'news', kind: 'live', state: 'live', fetchedAt: FETCHED, observedAt: items[items.length - 1]!.publishedAt, lastGoodAt: FETCHED, stale: false, ttlSeconds: 60, attribution: [] },
  providers: { 't.me/Osintdefender': { ok: true, count: items.length, ms: 780, age_s: 0 } },
  items,
  sources: [{ handle: 'Osintdefender', name: 'OSINTdefender', lean: osint.lean, bloc: osint.bloc, kind: 'telegram', count: items.length, latestAt: items[items.length - 1]!.publishedAt, ok: true }],
};
const offline503 = { meta: { ...good.meta, state: 'offline', fetchedAt: null, observedAt: null, stale: true }, providers: { 't.me/Osintdefender': { ok: false, count: 0, ms: 25000, age_s: null, error: 'timeout' } } };

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let client: QueryClient;
beforeEach(() => {
  // Only the clock is pinned (the last-good label prints the date when it is not today).
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-02T10:30:00Z'));
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  client.clear();
});

const chip = () => document.querySelector('.instrument-chip') as HTMLElement;

function mount() {
  render(
    <QueryClientProvider client={client}>
      <InstrumentFrame title="Live alerts" onClose={() => {}}>
        <AlertsPanel onClose={() => {}} />
      </InstrumentFrame>
    </QueryClientProvider>,
  );
}

describe('ALERTS chip and banner follow q.error (r8)', () => {
  it('a 503 after a good fetch: SOURCE OFFLINE chip in the error tone, labelled retained copy; recovery restores', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json(200, good)).mockResolvedValueOnce(json(503, offline503)).mockResolvedValueOnce(json(200, good));
    vi.stubGlobal('fetch', fetchMock);
    mount();
    await waitFor(() => expect(chip().textContent).toBe(`${items.length} RESULTS`));
    expect(chip().style.color).toBe('var(--alert-green)');
    expect(screen.queryByTestId('alerts-offline')).toBeNull();

    await act(() => client.refetchQueries({ queryKey: NEWS_QUERY_KEY }));
    await waitFor(() => expect(chip().textContent).toBe('SOURCE OFFLINE · 2026-09-30 20:05Z'));
    expect(chip().style.color).toBe('var(--alert-red)');
    expect(screen.getByTestId('alerts-offline').textContent).toBe('SOURCE OFFLINE — no channel or wire answered; showing the last copy received, fetched 2026-09-30 20:05 UTC.');
    // The retained rows stay, labelled as the last copy.
    expect(screen.getAllByTestId('alert-row')).toHaveLength(items.length);
    expect(screen.getByText(/alerts · last copy received/)).toBeTruthy();

    await act(() => client.refetchQueries({ queryKey: NEWS_QUERY_KEY }));
    await waitFor(() => expect(chip().textContent).toBe(`${items.length} RESULTS`));
    expect(chip().style.color).toBe('var(--alert-green)');
    expect(screen.queryByTestId('alerts-offline')).toBeNull();
  });

  it('a network error (no HTTP answer) is shown too, not silently ignored', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json(200, good)).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    mount();
    await waitFor(() => expect(chip().textContent).toBe(`${items.length} RESULTS`));
    await act(() => client.refetchQueries({ queryKey: NEWS_QUERY_KEY }));
    await waitFor(() => expect(chip().style.color).toBe('var(--alert-red)'));
    expect(chip().textContent).toMatch(/^SOURCE OFFLINE/);
    expect(screen.getByTestId('alerts-offline').textContent).toMatch(/^SOURCE OFFLINE — this server did not answer; showing the last copy received/);
  });
});

describe('alert_pins rail status (same query)', () => {
  it('goes offline on a failed refetch with retained data and recovers with the very same data object', () => {
    const fail = alertPinsStatus({ data: good, error: new FeedOfflineError(503, offline503.meta as never, null), isPending: false });
    expect(fail).toMatchObject({ state: 'offline', error: 'Source offline', lastGoodAt: FETCHED });
    expect(alertPinsStatus({ data: good, error: new TypeError('Failed to fetch'), isPending: false })).toMatchObject({ state: 'offline', error: 'unreachable', lastGoodAt: FETCHED });
    const back = alertPinsStatus({ data: good, error: null, isPending: false });
    expect(back).toMatchObject({ state: 'live', fetchedAt: FETCHED, count: items.filter((it) => it.place).length });
    expect(back).toHaveProperty('error', undefined);
    expect(alertPinsStatus({ data: undefined, error: null, isPending: true })).toEqual({ state: 'loading' });
  });
});
