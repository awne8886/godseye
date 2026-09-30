import type * as Http from '@/lib/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAPTURED_AT, FX, type Route } from '@/components/panels/intel/__fixtures__';
import { freshCache, req, resetCache } from '@/components/panels/intel/__fixtures__/routes';
import { cryptoFeed, tickerFeed } from '@/components/panels/intel/feeds';
import { earthquakeFeed } from '@/features/hazards/server/usgs';
import { TickerResponse } from '@/lib/schemas/intel';
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
  tickerFeed.stop();
  cryptoFeed.stop();
  earthquakeFeed().stop();
  resetCache();
  vi.useRealTimers();
});

describe('GET /api/ticker', () => {
  it('composes crypto + the five latest M4.0+ USGS quakes, each with its own observedAt', async () => {
    state.routes = [
      ['data-api.binance.vision', FX.binance],
      ['summary/2.5_day.geojson', FX.usgs],
    ];
    const res = await GET(req('/api/ticker'), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(TickerResponse.safeParse(body).success).toBe(true);
    expect(body.crypto.map((c: { symbol: string }) => c.symbol)).toEqual(['BTC', 'ETH', 'SOL']);
    expect(body.crypto.every((c: { observedAt: string | null }) => c.observedAt !== null)).toBe(true);
    expect(body.quakes.length).toBeLessThanOrEqual(5);
    expect(body.quakes.every((q: { magnitude: number; observedAt: string }) => q.magnitude >= 4 && !Number.isNaN(Date.parse(q.observedAt)))).toBe(true);
    const t = body.quakes.map((q: { observedAt: string }) => Date.parse(q.observedAt));
    expect([...t].sort((a, b) => b - a)).toEqual(t);
    expect(body.providers.crypto).toMatchObject({ ok: true, count: 3 });
    expect(body.providers.usgs).toMatchObject({ ok: true });
    expect(body.meta.feed).toBe('ticker');
  });

  it('still serves quakes when every crypto provider fails (crypto reported as failed)', async () => {
    state.routes = [['summary/2.5_day.geojson', FX.usgs]];
    const res = await GET(req('/api/ticker'), undefined);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.crypto).toEqual([]);
    expect(body.providers.crypto).toMatchObject({ ok: false });
  });

  it('answers 503 when both halves fail', async () => {
    state.routes = [];
    expect((await GET(req('/api/ticker'), undefined)).status).toBe(503);
  });
});
