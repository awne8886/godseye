import type * as Http from '@/lib/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAPTURED_AT, FX, type Route } from '@/components/panels/intel/__fixtures__';
import { freshCache, req, resetCache } from '@/components/panels/intel/__fixtures__/routes';
import { cryptoFeed } from '@/components/panels/intel/feeds';
import { CryptoResponse } from '@/lib/schemas/intel';
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
  cryptoFeed.stop();
  resetCache();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const get = async () => {
  const res = await GET(req('/api/crypto'), undefined);
  return { res, body: await res.json() };
};

describe('GET /api/crypto — provider fallback order', () => {
  it('uses Binance first and does not call the fallbacks', async () => {
    state.routes = [['data-api.binance.vision', FX.binance]];
    const { res, body } = await get();
    expect(res.status).toBe(200);
    expect(CryptoResponse.safeParse(body).success).toBe(true);
    expect(body.items.map((i: { source: string }) => i.source)).toEqual(['binance', 'binance', 'binance']);
    expect(body.items[0].observedAt).toBe(new Date(1790798582011).toISOString());
    expect(Object.keys(body.providers)).toEqual(['binance']);
    expect(body.meta.feed).toBe('crypto');
  });

  it('falls back Binance → Coinbase → Kraken; CoinGecko is skipped without its key', async () => {
    state.routes = [
      ['data-api.binance.vision', 451],
      ['api.exchange.coinbase.com/products/BTC-USD/ticker', FX.coinbaseTicker],
      ['api.exchange.coinbase.com/products/BTC-USD/stats', FX.coinbaseStats],
      ['api.kraken.com', FX.kraken],
    ];
    const { body } = await get();
    expect(CryptoResponse.safeParse(body).success).toBe(true);
    const by = Object.fromEntries(body.items.map((i: { symbol: string; source: string; observedAt: string | null }) => [i.symbol, i]));
    expect(by.BTC).toMatchObject({ source: 'coinbase', observedAt: '2026-09-30T20:03:01.787Z' });
    expect(by.ETH).toMatchObject({ source: 'kraken', observedAt: null });
    expect(by.SOL).toMatchObject({ source: 'kraken', observedAt: null });
    expect(body.providers.binance).toMatchObject({ ok: false, error: 'http_451' });
    expect(body.providers.coinbase).toMatchObject({ ok: true, count: 1 });
    expect(body.providers.kraken).toMatchObject({ ok: true, count: 2 });
    expect(body.providers.coingecko).toBeUndefined();
  });

  it('reports CoinGecko as not-configured when it would be needed, and 503 when all fail', async () => {
    state.routes = [];
    const { res, body } = await get();
    expect(res.status).toBe(503);
    expect(body.providers.coingecko).toMatchObject({ ok: false, skipped: 'not-configured' });
    expect(body.meta.state).toBe('offline');
  });
});
