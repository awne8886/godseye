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

describe('POST /api/ai/overview', () => {
  it('answers keyless as the labelled ANALYST with the digest brief, no-store', async () => {
    state.routes = HAPPY;
    const res = await POST(req('/api/ai/overview', { method: 'POST', body: { scope: 'alerts' } }), undefined);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
    const body = await res.json();
    expect(AiOverviewResponse.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ generatedBy: 'analyst', model: null, keySource: 'none', fallbackReason: 'no AI provider configured' });
    expect(body.text).toContain('Method: Keyword clustering');
    expect(body.brief.method).toMatch(/does not verify/);
    // Citations only reference rows the server holds.
    const news = await (await import('@/components/panels/intel/feeds')).newsFeed.get();
    const ids = new Set(news.data!.items.map((i) => i.id));
    expect(body.citations.every((c: { feed: string; id: string }) => c.feed === 'news' && ids.has(c.id))).toBe(true);
  });

  it('covers markets and chain scopes and rejects bad bodies', async () => {
    state.routes = HAPPY;
    const m = await (await POST(req('/api/ai/overview', { method: 'POST', body: { scope: 'markets' } }), undefined)).json();
    expect(AiOverviewResponse.safeParse(m).success).toBe(true);
    expect(m.text).toMatch(/instruments tracked/);
    const c = await (await POST(req('/api/ai/overview', { method: 'POST', body: { scope: 'chain' } }), undefined)).json();
    expect(c.text).toMatch(/on-chain exploits/);
    expect((await POST(req('/api/ai/overview', { method: 'POST', body: '{nope' }), undefined)).status).toBe(400);
    expect((await POST(req('/api/ai/overview', { method: 'POST', body: { scope: 'weather' } }), undefined)).status).toBe(400);
  });

  it('shares the fail-closed `ai` bucket: 5 requests per minute per client across AI routes', async () => {
    state.routes = HAPPY;
    const ip = '10.99.0.7';
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await POST(req('/api/ai/overview', { method: 'POST', body: { scope: 'markets' }, ip }), undefined)).status);
    expect(codes.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(codes[5]).toBe(429);
  });
});
