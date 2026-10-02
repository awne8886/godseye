import type * as Http from '@/lib/http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtureBuffer, STREAM_FX, type Call, type Route } from '../__fixtures__';
import { answerStream, streamModel, type ChatEvent, type ProviderChoice } from './ai';
import { CitationGate, claudeDelta, splitLines, streamRecords } from './ai-stream';

const state = vi.hoisted(() => ({ routes: [] as Route[], calls: [] as Call[] }));
vi.mock('@/lib/http', async (importOriginal) => {
  const orig = await importOriginal<typeof Http>();
  const { httpMock } = await import('../__fixtures__');
  return { ...orig, ...httpMock(() => state.routes, orig.HttpError, state.calls) };
});

afterEach(() => {
  state.routes = [];
  state.calls.length = 0;
});

async function* chunked(buf: Buffer | string, size: number): AsyncGenerator<Uint8Array> {
  const b = typeof buf === 'string' ? Buffer.from(buf) : buf;
  for (let i = 0; i < b.length; i += size) yield new Uint8Array(b.subarray(i, i + size));
}
const collect = async <T>(it: AsyncIterable<T>): Promise<T[]> => {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
};

const allowed = [
  { feed: 'news', id: 'tg:A/1', label: 'A: drones over Kyiv' },
  { feed: 'quake', id: 'us1', label: 'M5 somewhere' },
];
const prompt = { system: 'sys', turns: [{ role: 'user' as const, content: 'What is happening?' }], allowed, analystText: 'ANALYST TEXT for the fallback path', analystCitations: [allowed[0]!] };
const ENV = { ANTHROPIC_MODEL: 'claude-opus-5-5', GEMINI_MODEL: 'gemini-2.5-flash', OLLAMA_MODEL: 'llama3.2', OLLAMA_URL: 'http://ollama.internal:11434' };
const claude: ProviderChoice = { provider: 'claude', key: 'sk-ant-server-key-xxxxxxxx', keySource: 'server', reason: null };
const gemini: ProviderChoice = { provider: 'gemini', key: 'AIza-server-key-xxxxxxxxxxxxxxxx', keySource: 'server', reason: null };
const ollama: ProviderChoice = { provider: 'ollama', key: null, keySource: 'server', reason: null };
const NOW = () => Date.parse('2026-10-02T09:00:00Z');

const text = (ev: ChatEvent[]) => ev.flatMap((e) => (e.type === 'delta' ? [e.text] : [])).join('');

describe('shared line splitter', () => {
  it('splits LF and CRLF lines across chunk and UTF-8 boundaries', async () => {
    const src = 'a: Kyiv’s\r\nsecond\n\nthird';
    for (const size of [1, 2, 3, 5, 64]) expect(await collect(splitLines(chunked(src, size)))).toEqual(['a: Kyiv’s', 'second', '', 'third']);
  });
  it('dispatches SSE events on blank lines, joins multi-line data, skips comments and [DONE]', async () => {
    const src = ': keep-alive\nevent: x\ndata: {"a":\ndata: 1}\n\ndata: [DONE]\n\ndata: {"b":2}';
    expect(await collect(streamRecords(chunked(src, 4), 'sse'))).toEqual([
      { event: 'x', data: { a: 1 } },
      { event: null, data: { b: 2 } },
    ]);
  });
  it('reads NDJSON one object per line and rejects a corrupt record', async () => {
    expect(await collect(streamRecords(chunked('{"a":1}\n\n{"b":2}\n', 3), 'ndjson'))).toEqual([
      { event: null, data: { a: 1 } },
      { event: null, data: { b: 2 } },
    ]);
    await expect(collect(streamRecords(chunked('{"a":1}\n{oops\n', 3), 'ndjson'))).rejects.toThrow();
  });
  it('extracts only text_delta from the Claude fixture', async () => {
    const recs = await collect(streamRecords(chunked(fixtureBuffer(STREAM_FX.claude), 11), 'sse'));
    expect(recs.map(claudeDelta).filter(Boolean).join('')).toContain('[news:tg:FAKE/9]');
    expect(recs[0]?.event).toBe('message_start');
  });
});

describe('citation gate', () => {
  it('holds a marker split across deltas until it closes, keeps known ids and drops unknown ones', () => {
    const g = new CitationGate(allowed);
    expect(g.push('Strikes [ne')).toBe('Strikes ');
    expect(g.push('ws:tg:A/1] and [news:tg:X/')).toBe('[news:tg:A/1] and ');
    expect(g.push('9] then [quake:us1]')).toBe('then [quake:us1]');
    expect(g.citations().map((c) => c.id)).toEqual(['tg:A/1', 'us1']);
  });
  it('releases a bracket that cannot become a marker and drops an unfinished marker at the end', () => {
    const g = new CitationGate(allowed);
    expect(g.push('range [5 km]')).toBe('range [5 km]');
    expect(g.push(' see [news:tg:A')).toBe(' see ');
    expect(g.flush()).toBe('');
    const h = new CitationGate(allowed);
    expect(h.push('ends with [')).toBe('ends with ');
    expect(h.flush()).toBe('[');
  });
});

describe('streamModel (fixtures in each provider format)', () => {
  it('Claude: POST /v1/messages with stream:true, deltas from content_block_delta', async () => {
    state.routes = [['api.anthropic.com/v1/messages', STREAM_FX.claude]];
    const info: { model?: string } = {};
    const deltas = await collect(streamModel(claude, 'sys', prompt.turns, ENV, undefined, info));
    expect(deltas.length).toBe(5);
    expect(info.model).toBe('claude-opus-5-5');
    const call = state.calls[0]!;
    expect(JSON.parse(call.body!)).toMatchObject({ stream: true, model: 'claude-opus-5-5', max_tokens: 800 });
    expect(call.headers['anthropic-version']).toBe('2023-06-01');
  });
  it('Gemini: streamGenerateContent?alt=sse, CRLF-framed candidates', async () => {
    state.routes = [['generativelanguage.googleapis.com', STREAM_FX.gemini]];
    const deltas = await collect(streamModel(gemini, 'sys', prompt.turns, ENV));
    expect(deltas.join('')).toBe('Bottom line: drone strikes near Kyiv [news:tg:A/1] and a quake [quake:us1].');
    expect(state.calls[0]!.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse');
  });
  it('Ollama: /api/chat with stream:true, NDJSON message.content', async () => {
    state.routes = [['ollama.internal:11434/api/chat', STREAM_FX.ollama]];
    const deltas = await collect(streamModel(ollama, 'sys', prompt.turns, ENV));
    expect(deltas).toEqual(['Bottom', ' line: Kyiv reports drones ', '[news:tg:A/1].']);
    expect(JSON.parse(state.calls[0]!.body!)).toMatchObject({ stream: true, model: 'llama3.2' });
  });
});

describe('answerStream', () => {
  it('sends meta with the first delta, forwards gated deltas and verified citations', async () => {
    state.routes = [['api.anthropic.com/v1/messages', STREAM_FX.claude]];
    const ev = await collect(answerStream(claude, prompt, ENV, undefined, NOW));
    expect(ev[0]).toEqual({ type: 'meta', generatedBy: 'claude', model: 'claude-opus-5-5', fallbackReason: null, keySource: 'server' });
    expect(ev.filter((e) => e.type === 'delta').length).toBeGreaterThan(2);
    expect(text(ev)).toBe('Bottom line: drone strikes reported near Kyiv [news:tg:A/1] — one-sided (Kyiv’s claim); a M5 quake [quake:us1].');
    expect(text(ev)).not.toContain('FAKE');
    expect(ev.at(-1)).toEqual({ type: 'done', citations: allowed, timestamp: '2026-10-02T09:00:00.000Z', truncated: null });
  });
  it('falls back to the labelled ANALYST when the model fails before its first delta', async () => {
    state.routes = [['api.anthropic.com/v1/messages', 401]];
    const ev = await collect(answerStream(claude, prompt, ENV, undefined, NOW));
    expect(ev[0]).toEqual({ type: 'meta', generatedBy: 'analyst', model: null, fallbackReason: 'claude unavailable (http_401)', keySource: 'none' });
    expect(text(ev)).toBe(prompt.analystText);
    expect(ev.at(-1)).toMatchObject({ type: 'done', citations: [allowed[0]], truncated: null });
  });
  it('reports a mid-stream error as truncated instead of switching authors', async () => {
    state.routes = [['api.anthropic.com/v1/messages', STREAM_FX.claudeError]];
    const ev = await collect(answerStream(claude, prompt, ENV, undefined, NOW));
    expect(ev[0]).toMatchObject({ type: 'meta', generatedBy: 'claude' });
    expect(text(ev)).toBe('Partial answer ');
    expect(ev.at(-1)).toMatchObject({ type: 'done', truncated: 'stream_overloaded_error' });
  });
  it('answers as the ANALYST with the selection reason when no model is configured', async () => {
    const ev = await collect(answerStream({ provider: 'analyst', key: null, keySource: 'none', reason: 'no AI provider configured' }, prompt, ENV, undefined, NOW));
    expect(ev[0]).toMatchObject({ generatedBy: 'analyst', fallbackReason: 'no AI provider configured' });
    expect(state.calls).toHaveLength(0);
  });
});
