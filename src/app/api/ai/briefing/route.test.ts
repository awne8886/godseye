import type * as Http from '@/lib/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAPTURED_AT, HAPPY, type Call, type Route } from '@/components/panels/intel/__fixtures__';
import { freshCache, req, resetCache } from '@/components/panels/intel/__fixtures__/routes';
import { chainFeed, cryptoFeed, marketsFeed, newsFeed } from '@/components/panels/intel/feeds';
import { earthquakeFeed } from '@/features/hazards/server/usgs';
import { AiOverviewResponse } from '@/lib/schemas/intel';
import { POST } from './route';

const state = vi.hoisted(() => ({ routes: [] as Route[], calls: [] as Call[] }));
vi.mock('@/lib/http', async (importOriginal) => {
  const orig = await importOriginal<typeof Http>();
  const { httpMock } = await import('@/components/panels/intel/__fixtures__');
  return { ...orig, ...httpMock(() => state.routes, orig.HttpError, state.calls) };
});

const USER_KEY = 'sk-ant-api03-VISITOR-secret-0123456789abcdef';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: CAPTURED_AT });
  freshCache();
  state.calls.length = 0;
  for (const k of ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY_1', 'OLLAMA_URL']) vi.stubEnv(k, '');
});
afterEach(() => {
  for (const f of [newsFeed, cryptoFeed, marketsFeed, chainFeed, earthquakeFeed()]) f.stop();
  resetCache();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('POST /api/ai/briefing', () => {
  it('uses a visitor key once (header only), falls back to the ANALYST on failure, never logs or echoes it', async () => {
    const logs: string[] = [];
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')));
    state.routes = [...HAPPY, ['api.anthropic.com', 401]];
    const res = await POST(req('/api/ai/briefing', { method: 'POST', body: { horizon: '24h' }, headers: { 'x-ai-key': USER_KEY } }), undefined);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
    const raw = await res.text();
    expect(raw).not.toContain(USER_KEY);
    const body = JSON.parse(raw);
    expect(AiOverviewResponse.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ generatedBy: 'analyst', keySource: 'none', fallbackReason: 'claude unavailable (http_401)' });
    expect(body.text).toMatch(/^BLUF: /);
    expect(body.text).toMatch(/not forecast by the heuristic analyst/);
    // The key went only to Anthropic, only in a header, never in a URL.
    const anthropic = state.calls.filter((c) => c.url.includes('anthropic'));
    expect(anthropic.length).toBeGreaterThan(0);
    expect(anthropic.every((c) => c.headers['x-api-key'] === USER_KEY && !c.url.includes(USER_KEY))).toBe(true);
    expect(state.calls.filter((c) => !c.url.includes('anthropic')).some((c) => JSON.stringify(c).includes(USER_KEY))).toBe(false);
    expect(logs.join('\n')).not.toContain(USER_KEY);
  });

  it('returns the model answer with its provenance when the model answers', async () => {
    state.routes = [
      ...HAPPY,
      ['api.anthropic.com/v1/models', Buffer.from(JSON.stringify({ data: [{ id: 'listed-model' }] }))],
      ['api.anthropic.com/v1/messages', Buffer.from(JSON.stringify({ content: [{ type: 'text', text: 'BLUF: quiet. [news:not-in-prompt]' }] }))],
    ];
    const body = await (await POST(req('/api/ai/briefing', { method: 'POST', body: { horizon: '72h' }, headers: { 'x-ai-key': USER_KEY } }), undefined)).json();
    expect(body).toMatchObject({ generatedBy: 'claude', model: 'listed-model', keySource: 'user', fallbackReason: null, text: 'BLUF: quiet.', citations: [] });
  });
});
