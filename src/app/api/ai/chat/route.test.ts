import type * as Http from '@/lib/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAPTURED_AT, HAPPY, type Route } from '@/components/panels/intel/__fixtures__';
import { freshCache, req, resetCache } from '@/components/panels/intel/__fixtures__/routes';
import { chainFeed, cryptoFeed, marketsFeed, newsFeed } from '@/components/panels/intel/feeds';
import { earthquakeFeed } from '@/features/hazards/server/usgs';
import { AiGeneratedBy, AiCitation } from '@/lib/schemas/intel';
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

describe('POST /api/ai/chat (NDJSON stream)', () => {
  it('streams meta → deltas → done, labelled ANALYST when keyless', async () => {
    state.routes = HAPPY;
    const res = await POST(req('/api/ai/chat', { method: 'POST', body: { messages: [{ role: 'user', content: 'Anything about Ukraine or drones?' }] } }), undefined);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/x-ndjson/);
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
    const lines = (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
    expect(lines[0]).toMatchObject({ type: 'meta', generatedBy: 'analyst', model: null, keySource: 'none' });
    expect(AiGeneratedBy.safeParse(lines[0].generatedBy).success).toBe(true);
    const text = lines.filter((l) => l.type === 'delta').map((l) => l.text).join('');
    expect(text.length).toBeGreaterThan(10);
    const done = lines.at(-1);
    expect(done.type).toBe('done');
    expect(done.citations.every((c: unknown) => AiCitation.safeParse(c).success)).toBe(true);
  });

  it('requires the last message to be the user’s', async () => {
    const bad = { messages: [{ role: 'assistant', content: 'hi' }] };
    expect((await POST(req('/api/ai/chat', { method: 'POST', body: bad }), undefined)).status).toBe(400);
  });
});
