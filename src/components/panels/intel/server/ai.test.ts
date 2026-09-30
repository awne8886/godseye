import type * as Http from '@/lib/http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Call, Route } from '../__fixtures__';
import { answer, filterCitations, keyProvider, selectProvider, type ChatTurn } from './ai';

const state = vi.hoisted(() => ({ routes: [] as Route[], calls: [] as Call[] }));
vi.mock('@/lib/http', async (importOriginal) => {
  const orig = await importOriginal<typeof Http>();
  const { httpMock } = await import('../__fixtures__');
  return { ...orig, ...httpMock(() => state.routes, orig.HttpError, state.calls) };
});

afterEach(() => {
  state.routes = [];
  state.calls.length = 0;
  vi.restoreAllMocks();
});

const USER_KEY = 'sk-ant-api03-visitorKEYvisitorKEYvisitorKEY';
const turns: ChatTurn[] = [{ role: 'user', content: 'What is happening?' }];
const allowed = [
  { feed: 'news', id: 'tg:A/1', label: 'A: one' },
  { feed: 'quake', id: 'us1', label: 'M5 somewhere' },
];
const prompt = { system: 'sys', turns, allowed, analystText: 'ANALYST TEXT', analystCitations: [allowed[0]!] };

describe('provider selection', () => {
  it('falls back to the ANALYST with a reason when nothing is configured', () => {
    expect(selectProvider('auto', null, {})).toEqual({ provider: 'analyst', key: null, keySource: 'none', reason: 'no AI provider configured' });
    expect(selectProvider('claude', null, { GEMINI_API_KEY_1: 'g' }).reason).toBe('claude not configured on this server');
    expect(selectProvider('analyst', null, { ANTHROPIC_API_KEY: 'k' }).provider).toBe('analyst');
  });
  it('prefers claude → gemini → ollama on auto and honours the Settings preference', () => {
    const env = { ANTHROPIC_API_KEY: 'server-a', GEMINI_API_KEY_1: 'server-g', OLLAMA_URL: 'http://ollama:11434' };
    expect(selectProvider('auto', null, env)).toMatchObject({ provider: 'claude', keySource: 'server' });
    expect(selectProvider('gemini', null, env)).toMatchObject({ provider: 'gemini', key: 'server-g' });
    expect(selectProvider('ollama', null, env)).toMatchObject({ provider: 'ollama', key: null, keySource: 'server' });
  });
  it('uses a visitor key for its own provider unless the operator disabled visitor keys', () => {
    expect(keyProvider(USER_KEY)).toBe('claude');
    expect(keyProvider('AIzaSyA-visitor-visitor-visitor1')).toBe('gemini');
    expect(selectProvider('auto', USER_KEY, {})).toMatchObject({ provider: 'claude', key: USER_KEY, keySource: 'user' });
    const off = selectProvider('auto', USER_KEY, { DISABLE_USER_AI_KEYS: 'true' });
    expect(off.provider).toBe('analyst');
    expect(off.reason).toContain('visitor keys are disabled');
    expect(selectProvider('auto', 'not-a-key-format-123', {}).reason).toContain('not recognised');
  });
});

describe('citations', () => {
  it('drops markers whose ids were not in the prompt', () => {
    const r = filterCitations('Strikes reported [news:tg:A/1] and [news:tg:FAKE/9], quake [quake:us1].', allowed);
    expect(r.text).toBe('Strikes reported [news:tg:A/1] and, quake [quake:us1].');
    expect(r.citations.map((c) => c.id)).toEqual(['tg:A/1', 'us1']);
  });
});

describe('answer()', () => {
  it('returns the model text with generatedBy/model/keySource and filtered citations', async () => {
    state.routes = [
      ['api.anthropic.com/v1/models', Buffer.from(JSON.stringify({ data: [{ id: 'model-from-list' }] }))],
      ['api.anthropic.com/v1/messages', Buffer.from(JSON.stringify({ content: [{ type: 'text', text: 'Bottom line [news:tg:A/1] [news:tg:X/2]' }] }))],
    ];
    const r = await answer(selectProvider('auto', USER_KEY, {}), prompt, {});
    expect(r).toMatchObject({ generatedBy: 'claude', model: 'model-from-list', keySource: 'user', fallbackReason: null, text: 'Bottom line [news:tg:A/1]' });
    const msg = state.calls.find((c) => c.url.includes('/v1/messages'))!;
    expect(msg.headers['x-api-key']).toBe(USER_KEY);
    expect(msg.url).not.toContain(USER_KEY);
  });

  it('falls back to the ANALYST with a short reason and never logs the key', async () => {
    const logs: string[] = [];
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' ')));
    state.routes = [['api.anthropic.com', 401]];
    const r = await answer(selectProvider('auto', USER_KEY, {}), prompt, {});
    expect(r).toEqual({ generatedBy: 'analyst', model: null, fallbackReason: 'claude unavailable (http_401)', keySource: 'none', text: 'ANALYST TEXT', citations: [allowed[0]] });
    expect(JSON.stringify(r)).not.toContain(USER_KEY);
    expect(logs.join('\n')).not.toContain(USER_KEY);
  });

  it('answers as ANALYST up front with the selection reason', async () => {
    const r = await answer(selectProvider('auto', null, {}), prompt, {});
    expect(r.generatedBy).toBe('analyst');
    expect(r.fallbackReason).toBe('no AI provider configured');
    expect(state.calls).toHaveLength(0);
  });

  it('calls Gemini and Ollama with the discovered model', async () => {
    state.routes = [
      ['generativelanguage.googleapis.com/v1beta/models?', Buffer.from(JSON.stringify({ models: [{ name: 'models/embed', supportedGenerationMethods: ['embedContent'] }, { name: 'models/g-flash', displayName: 'G Flash', supportedGenerationMethods: ['generateContent'] }] }))],
      ['generateContent', Buffer.from(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Gemini says hi' }] } }] }))],
      ['ollama:11434/api/tags', Buffer.from(JSON.stringify({ models: [{ name: 'local-model' }] }))],
      ['ollama:11434/api/chat', Buffer.from(JSON.stringify({ message: { content: 'Ollama says hi' } }))],
    ];
    const g = await answer(selectProvider('gemini', null, { GEMINI_API_KEY_1: 'srv' }), prompt, { GEMINI_API_KEY_1: 'srv' });
    expect(g).toMatchObject({ generatedBy: 'gemini', model: 'g-flash', text: 'Gemini says hi', keySource: 'server' });
    const o = await answer(selectProvider('ollama', null, { OLLAMA_URL: 'http://ollama:11434' }), prompt, { OLLAMA_URL: 'http://ollama:11434' });
    expect(o).toMatchObject({ generatedBy: 'ollama', model: 'local-model', text: 'Ollama says hi' });
  });
});
