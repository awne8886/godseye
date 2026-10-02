import type * as Http from '@/lib/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAPTURED_AT, FX, type Route } from '@/components/panels/intel/__fixtures__';
import { freshCache, req, resetCache } from '@/components/panels/intel/__fixtures__/routes';
import { cryptoFeed, marketsFeed } from '@/components/panels/intel/feeds';
import { MarketsResponse } from '@/lib/schemas/intel';
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

describe('GET /api/markets', () => {
  it('serves quotes with per-quote observedAt, 12 sessions, breadth and providers', async () => {
    state.routes = [
      ['query1.finance.yahoo.com', FX.yahooGspc],
      ['data-api.binance.vision', FX.binance],
    ];
    const res = await GET(req('/api/markets'), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(MarketsResponse.safeParse(body).success).toBe(true);
    expect(body.sessions).toHaveLength(12);
    expect(body.sessions.find((s: { exchange: string }) => s.exchange === 'NYSE').open).toBe(false);
    const yahoo = body.quotes.filter((q: { source: string }) => q.source === 'yahoo');
    expect(yahoo.length).toBeGreaterThan(10);
    expect(yahoo.every((q: { unofficial: boolean; observedAt: string }) => q.unofficial && q.observedAt === new Date(1790798581000).toISOString())).toBe(true);
    const btc = body.quotes.find((q: { symbol: string }) => q.symbol === 'BTC');
    expect(btc).toMatchObject({ group: 'crypto', source: 'binance', unofficial: false });
    expect(body.breadth.up + body.breadth.down + body.breadth.flat).toBe(body.quotes.length);
    expect(body.providers.yahoo).toMatchObject({ ok: true });
    expect(body.providers.crypto).toMatchObject({ ok: true, count: 3 });
    // The maritime feed is not registered in this process: reported, not hidden.
    expect(body.providers.maritime).toMatchObject({ ok: false });
    expect(body.meta.note).toMatch(/other holidays and half days are not modelled/);
  });

  it('answers 503 SOURCE OFFLINE when Yahoo and every crypto provider fail', async () => {
    state.routes = [];
    const res = await GET(req('/api/markets'), undefined);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('source_offline');
    expect(body.providers.yahoo).toMatchObject({ ok: false });
  });
});
