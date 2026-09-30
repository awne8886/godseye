import type * as Http from '@/lib/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAPTURED_AT, FX, type Route } from '@/components/panels/intel/__fixtures__';
import { freshCache, req, resetCache } from '@/components/panels/intel/__fixtures__/routes';
import { MarketHistoryResponse } from '@/lib/schemas/intel';
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
  resetCache();
  vi.useRealTimers();
});

describe('GET /api/markets/history', () => {
  it('serves OHLC candles for an allow-listed symbol', async () => {
    state.routes = [['chart/GC%3DF?range=1mo&interval=1d', FX.yahooGc]];
    const res = await GET(req('/api/markets/history?symbol=GC%3DF&range=1M'), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(MarketHistoryResponse.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ symbol: 'GC=F', range: '1M', interval: '1d', currency: 'USD' });
    expect(body.candles.length).toBeGreaterThan(15);
    expect(body.providers.yahoo).toMatchObject({ ok: true });
    expect(body.meta.feed).toBe('markets-history');
  });

  it('rejects symbols off the allow-list and unknown ranges', async () => {
    expect((await GET(req('/api/markets/history?symbol=EVIL'), undefined)).status).toBe(400);
    expect((await GET(req('/api/markets/history?symbol=GC%3DF&range=5Y'), undefined)).status).toBe(400);
  });

  it('answers 503 when Yahoo fails', async () => {
    state.routes = [['query1.finance.yahoo.com', 429]];
    const res = await GET(req('/api/markets/history?symbol=%5EGSPC&range=1Y'), undefined);
    expect(res.status).toBe(503);
    expect((await res.json()).providers.yahoo).toMatchObject({ ok: false, error: 'http_429' });
  });
});
