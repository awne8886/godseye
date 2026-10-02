/**
 * R3 round-4 MINOR-2 (ported repro): /api/ticker derives its state from its inputs. With crypto and
 * USGS both offline for 3 h it is not LIVE and both providers are ok:false; with one input down the
 * other stays live and `providers` names the failure.
 * Fixtures: binance-24hr / usgs-2.5_day, captured 2026-09-30 ~20:03 UTC.
 */
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

describe('/api/ticker state follows its inputs', () => {
  it('is OFFLINE (last-good rows kept) when crypto and USGS have both been down for 3 h', async () => {
    state.routes = [['data-api.binance.vision', FX.binance], ['summary/2.5_day.geojson', FX.usgs]];
    const first = await (await GET(req('/api/ticker'), undefined)).json();
    expect(first.meta.state).toBe('live');
    state.routes = [];
    vi.setSystemTime(CAPTURED_AT + 3 * 3600_000);
    await cryptoFeed.refresh().catch(() => {});
    await earthquakeFeed().refresh().catch(() => {});
    await tickerFeed.refresh().catch(() => {});
    const res = await GET(req('/api/ticker'), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(TickerResponse.safeParse(body).success).toBe(true);
    expect(body.meta.state).toBe('offline');
    expect(body.meta.lastGoodAt).toBe(new Date(CAPTURED_AT).toISOString());
    expect(body.providers.crypto).toMatchObject({ ok: false, error: 'offline' });
    expect(body.providers.usgs).toMatchObject({ ok: false, error: 'offline', age_s: 3 * 3600 });
    expect(body.crypto).toEqual(first.crypto);
  });

  it('stays live on the input that answers and reports the one that does not', async () => {
    state.routes = [['data-api.binance.vision', FX.binance], ['summary/2.5_day.geojson', FX.usgs]];
    await GET(req('/api/ticker'), undefined);
    state.routes = [['data-api.binance.vision', FX.binance]];
    vi.setSystemTime(CAPTURED_AT + 3 * 3600_000);
    await cryptoFeed.refresh();
    await earthquakeFeed().refresh().catch(() => {});
    await tickerFeed.refresh({ force: true });
    const body = await (await GET(req('/api/ticker'), undefined)).json();
    expect(TickerResponse.safeParse(body).success).toBe(true);
    expect(body.meta.state).toBe('live');
    expect(body.providers.crypto).toMatchObject({ ok: true });
    expect(body.providers.usgs).toMatchObject({ ok: false, error: 'offline' });
  });
});
