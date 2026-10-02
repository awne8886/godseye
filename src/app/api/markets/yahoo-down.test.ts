/**
 * R3 round-4 MAJOR-2 (ported repro r3-yahoo-down): when Yahoo fails, the last-good equity quotes
 * are kept with their own observedAt plus `lastGoodAt`, the yahoo provider is ok:false with a
 * growing age, and the chip reads SOURCE OFFLINE with the last-good time (never DELAYED). With
 * every quote source down the board is served as STALE, not LIVE.
 * Fixtures: yahoo-gspc-1d-5m / binance-24hr, captured 2026-09-30 ~20:03 UTC.
 */
import type * as Http from '@/lib/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAPTURED_AT, FX, type Route } from '@/components/panels/intel/__fixtures__';
import { freshCache, req, resetCache } from '@/components/panels/intel/__fixtures__/routes';
import { cryptoFeed, marketsFeed, mergeYahoo } from '@/components/panels/intel/feeds';
import { marketsChip } from '@/components/panels/markets/markets-chip';
import { MarketsResponse } from '@/lib/schemas/intel';
import type { Quote } from '@/lib/types';
import { GET } from './route';

const state = vi.hoisted(() => ({ routes: [] as Route[] }));
vi.mock('@/lib/http', async (importOriginal) => {
  const orig = await importOriginal<typeof Http>();
  const { httpMock } = await import('@/components/panels/intel/__fixtures__');
  return { ...orig, ...httpMock(() => state.routes, orig.HttpError) };
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: CAPTURED_AT });
  freshCache();
});
afterEach(() => {
  marketsFeed.stop();
  cryptoFeed.stop();
  resetCache();
  vi.useRealTimers();
});

const NYSE_OPEN = Date.parse('2026-10-01T14:00:00Z');
type Q = { source: string; group: string; symbol: string; observedAt: string | null; lastGoodAt?: string };

describe('/api/markets with Yahoo down', () => {
  it('keeps the last-good equity board and the chip reads SOURCE OFFLINE with its time', async () => {
    state.routes = [['query1.finance.yahoo.com', FX.yahooGspc], ['data-api.binance.vision', FX.binance]];
    const first = await (await GET(req('/api/markets'), undefined)).json();
    const firstYahoo = (first.quotes as Q[]).filter((q) => q.source === 'yahoo');
    expect(firstYahoo.length).toBeGreaterThan(10);
    expect(firstYahoo.every((q) => q.lastGoodAt === undefined)).toBe(true);

    state.routes = [['query1.finance.yahoo.com', 503], ['data-api.binance.vision', FX.binance]];
    vi.setSystemTime(NYSE_OPEN);
    await cryptoFeed.refresh().catch(() => {});
    await marketsFeed.refresh().catch(() => {});
    const res = await GET(req('/api/markets'), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(MarketsResponse.safeParse(body).success).toBe(true);
    expect(body.providers.yahoo).toMatchObject({ ok: false, count: 0, error: 'http_503', age_s: (NYSE_OPEN - CAPTURED_AT) / 1000 });
    expect(body.providers.crypto).toMatchObject({ ok: true });
    expect(body.meta).toMatchObject({ feed: 'markets', kind: 'live' });
    const kept = (body.quotes as Q[]).filter((q) => q.source === 'yahoo');
    expect(kept.map((q) => q.symbol)).toEqual(firstYahoo.map((q) => q.symbol));
    for (const q of kept) {
      expect(q.lastGoodAt).toBe(new Date(CAPTURED_AT).toISOString());
      // Each quote keeps its own observation time.
      expect(q.observedAt).toBe(firstYahoo.find((f) => f.symbol === q.symbol)!.observedAt);
    }
    const chip = marketsChip(body, NYSE_OPEN);
    expect(chip.text).not.toBe('DELAYED');
    expect(chip).toMatchObject({ text: 'SOURCE OFFLINE · 2026-09-30 20:05Z', tone: 'error' });
    expect(chip.title).toBe('Yahoo chart endpoint offline (http_503) — last good 2026-09-30 20:05 UTC');
  });

  it('serves the board as STALE with every quote source down (never LIVE on last-good data)', async () => {
    state.routes = [['query1.finance.yahoo.com', FX.yahooGspc], ['data-api.binance.vision', FX.binance]];
    await GET(req('/api/markets'), undefined);
    state.routes = [];
    vi.setSystemTime(CAPTURED_AT + 5 * 60_000);
    await cryptoFeed.refresh({ force: true }).catch(() => {});
    await marketsFeed.refresh({ force: true }).catch(() => {});
    const body = await (await GET(req('/api/markets'), undefined)).json();
    expect(MarketsResponse.safeParse(body).success).toBe(true);
    expect(body.meta.state).toBe('stale');
    expect(body.providers.yahoo).toMatchObject({ ok: false, age_s: 300 });
    expect(body.providers.crypto).toMatchObject({ ok: false });
    expect(body.quotes.some((q: Q) => q.source === 'yahoo')).toBe(true);
    expect(marketsChip(body, CAPTURED_AT + 5 * 60_000).text).toBe('STALE');
  });
});

describe('mergeYahoo', () => {
  const quote = (symbol: string, extra: Partial<Quote> = {}): Quote => ({ symbol, name: symbol, group: 'indices', price: 1, changePct: 0, currency: 'USD', spark: [], marketOpen: true, observedAt: '2026-09-30T20:00:00.000Z', source: 'yahoo', unofficial: true, ...extra });
  it('keeps each symbol the latest run missed, marked with when Yahoo last answered for it', () => {
    const previous = { quotes: [quote('^GSPC'), quote('^DJI', { lastGoodAt: '2026-09-29T20:00:00.000Z' })], breadth: { up: 0, down: 0, flat: 2 }, scmAlerts: [], yahooOkAt: CAPTURED_AT };
    const out = mergeYahoo([quote('^IXIC')], previous);
    expect(out.map((q) => q.symbol)).toEqual(['^GSPC', '^IXIC', '^DJI']);
    expect(out[0]).toMatchObject({ lastGoodAt: new Date(CAPTURED_AT).toISOString(), marketOpen: null });
    expect(out[1]!.lastGoodAt).toBeUndefined();
    expect(out[2]!.lastGoodAt).toBe('2026-09-29T20:00:00.000Z');
  });
});
