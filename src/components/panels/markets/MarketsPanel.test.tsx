// @vitest-environment jsdom
/**
 * r8 (same pattern as the ALERTS chip): a failed /api/markets refetch kept the board's chip at
 * DELAYED/LIVE. The failure now owns the chip and the retained board is labelled. The quote comes
 * from a recorded Yahoo chart (2026-09-30); fetch is stubbed, no network.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstrumentFrame } from '@/components/hud/PanelChrome';
import type { MarketsResponse } from '@/lib/types';
import { FX, fixtureJson } from '../intel/__fixtures__';
import { SYMBOLS, quoteFromChart, type YahooChart } from '../intel/server/markets';
import { sessionsAt } from '../intel/server/sessions';
import { MarketsPanel } from './MarketsPanel';

const AT = Date.parse('2026-09-30T20:05:00Z');
const quote = quoteFromChart(SYMBOLS[0]!, fixtureJson<YahooChart>(FX.yahooGspc), AT)!;
const FETCHED = '2026-09-30T20:05:00.000Z';
const good: MarketsResponse = {
  meta: { feed: 'markets', kind: 'live', state: 'live', fetchedAt: FETCHED, observedAt: quote.observedAt, lastGoodAt: FETCHED, stale: false, ttlSeconds: 60, attribution: [] },
  providers: { yahoo: { ok: true, count: 1, ms: 400, age_s: 0 } },
  quotes: [quote],
  sessions: sessionsAt(Date.parse('2026-09-30T14:00:00Z')),
  breadth: { up: 1, down: 0, flat: 0 },
  scmAlerts: [],
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-02T10:30:00Z'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('MARKETS chip follows a failed refetch (r8)', () => {
  it('SOURCE OFFLINE in the error tone over a retained board, and the board is labelled', async () => {
    let marketsCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.startsWith('/api/markets')) return ++marketsCalls === 1 ? json(200, good) : Promise.reject(new TypeError('Failed to fetch'));
        return json(503, { meta: null, providers: {} });
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <InstrumentFrame title="Markets" onClose={() => {}}>
          <MarketsPanel onClose={() => {}} />
        </InstrumentFrame>
      </QueryClientProvider>,
    );
    const chip = () => document.querySelector('.instrument-chip') as HTMLElement;
    await waitFor(() => expect(chip().textContent).toBe('DELAYED'));
    expect(screen.queryByTestId('markets-offline')).toBeNull();

    await act(() => client.refetchQueries({ queryKey: ['intel', 'markets'] }));
    await waitFor(() => expect(chip().textContent).toBe('SOURCE OFFLINE · 2026-09-30 20:05Z'));
    expect(chip().style.color).toBe('var(--alert-red)');
    expect(screen.getByTestId('markets-offline').textContent).toBe('SOURCE OFFLINE — this server did not answer; showing the last copy received, fetched 2026-09-30 20:05 UTC.');
    // Sections that never answered say so without claiming a retained copy.
    expect(screen.getByText('SOURCE OFFLINE — NOAA SWPC did not answer.')).toBeTruthy();
    client.clear();
  });
});
