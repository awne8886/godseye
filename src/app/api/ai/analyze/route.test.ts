import type * as Http from '@/lib/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAPTURED_AT, HAPPY, type Route } from '@/components/panels/intel/__fixtures__';
import { freshCache, req, resetCache } from '@/components/panels/intel/__fixtures__/routes';
import { chainFeed, cryptoFeed, marketsFeed, newsFeed } from '@/components/panels/intel/feeds';
import { earthquakeFeed } from '@/features/hazards/server/usgs';
import { AiOverviewResponse } from '@/lib/schemas/intel';
import { POST } from './route';

const state = vi.hoisted(() => ({ routes: [] as Route[] }));
vi.mock('@/lib/http', async (importOriginal) => {
  const orig = await importOriginal<typeof Http>();
  const { httpMock } = await import('@/components/panels/intel/__fixtures__');
  return { ...orig, ...httpMock(() => state.routes, orig.HttpError) };
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: CAPTURED_AT });
  freshCache();
  for (const k of ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY_1', 'OLLAMA_URL']) vi.stubEnv(k, '');
});
afterEach(() => {
  for (const f of [newsFeed, cryptoFeed, marketsFeed, chainFeed, earthquakeFeed()]) f.stop();
  resetCache();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('POST /api/ai/analyze', () => {
  it('reads out what the feeds place near a point (ANALYST, citations from those rows only)', async () => {
    state.routes = HAPPY;
    const res = await POST(req('/api/ai/analyze', { method: 'POST', body: { lat: 50.45, lng: 30.52 } }), undefined);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
    const body = await res.json();
    expect(AiOverviewResponse.safeParse(body).success).toBe(true);
    expect(body.generatedBy).toBe('analyst');
    expect(body.text).toMatch(/^Within 300 km of 50\.45, 30\.52/);
    expect(body.text).toMatch(/keyword geoparsed/);
  });

  it('honours the Settings preference "analyst" even when a server key exists', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'server-key-value');
    state.routes = HAPPY;
    const body = await (await POST(req('/api/ai/analyze', { method: 'POST', body: { lat: 0, lng: 0, provider: 'analyst' } }), undefined)).json();
    expect(body).toMatchObject({ generatedBy: 'analyst', fallbackReason: 'analyst selected in settings', keySource: 'none' });
  });

  it('rejects out-of-range coordinates', async () => {
    expect((await POST(req('/api/ai/analyze', { method: 'POST', body: { lat: 91, lng: 0 } }), undefined)).status).toBe(400);
  });
});
