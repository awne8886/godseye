import type * as Http from '@/lib/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAPTURED_AT, FX, type Route } from '@/components/panels/intel/__fixtures__';
import { freshCache, req, resetCache } from '@/components/panels/intel/__fixtures__/routes';
import { chainFeed } from '@/components/panels/intel/feeds';
import { ChainBriefResponse } from '@/lib/schemas/intel';
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
  chainFeed.stop();
  resetCache();
  vi.useRealTimers();
});

describe('GET /api/chain/daily', () => {
  it('serves exploits within the window; OpenSanctions is skipped without a key (licence/keyed)', async () => {
    state.routes = [
      ['api.llama.fi/hacks', FX.llama],
      ['services.nvd.nist.gov', FX.nvd],
    ];
    const res = await GET(req('/api/chain/daily?days=120'), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(ChainBriefResponse.safeParse(body).success).toBe(true);
    expect(body.windowDays).toBe(120);
    expect(body.exploits.length).toBeGreaterThan(0);
    expect(body.providers.opensanctions).toMatchObject({ ok: false, skipped: 'not-configured' });
    expect(body.degraded).toContain('opensanctions');
    expect(body.meta.feed).toBe('chain-daily');
  });

  it('validates the window and answers 503 when DefiLlama and NVD both fail', async () => {
    expect((await GET(req('/api/chain/daily?days=500'), undefined)).status).toBe(400);
    state.routes = [];
    const res = await GET(req('/api/chain/daily'), undefined);
    expect(res.status).toBe(503);
    expect((await res.json()).providers.defillama).toMatchObject({ ok: false });
  });
});
