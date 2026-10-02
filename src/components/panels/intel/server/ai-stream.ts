/**
 * Model token streams: one shared line splitter for SSE (Claude, Gemini `alt=sse`) and NDJSON
 * (Ollama), the per-provider delta extractors, and the citation gate that keeps a `[feed:id]` marker
 * from reaching the client until it is complete and verified against the prompt's rows.
 *
 * Stream formats (provider documentation, re-read 2026-10-02):
 *   Claude  — `event: content_block_delta` / `data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"…"}}`;
 *             `event: error` carries `{"type":"error","error":{…}}` mid-stream.
 *   Gemini  — `data: {"candidates":[{"content":{"parts":[{"text":"…"}]}}]}` blocks separated by CRLF CRLF.
 *   Ollama  — one JSON object per line: `{"message":{"role":"assistant","content":"…"},"done":false}`.
 * Owner: panels-alerts-markets-dossier-graph. Server-only (no Node APIs; unit-testable).
 */

export type StreamFormat = 'sse' | 'ndjson';

/** Split a byte stream into text lines (LF or CRLF), decoding UTF-8 across chunk boundaries. */
export async function* splitLines(body: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const dec = new TextDecoder();
  let buf = '';
  for await (const chunk of body) {
    buf += dec.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      yield buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
    }
  }
  buf += dec.decode();
  if (buf) yield buf.replace(/\r$/, '');
}

export interface StreamRecord {
  /** SSE `event:` name (null for NDJSON or unnamed SSE events). */
  event: string | null;
  data: unknown;
}

/**
 * Parsed JSON records from an SSE or NDJSON body, through the one line splitter. SSE `data:` lines
 * of one event are joined with `\n` and dispatched on the blank line; comments (`:`) are skipped. A
 * record that is not JSON throws (a corrupt stream must not be rendered as an answer).
 */
export async function* streamRecords(body: AsyncIterable<Uint8Array>, format: StreamFormat): AsyncGenerator<StreamRecord> {
  if (format === 'ndjson') {
    for await (const line of splitLines(body)) {
      if (line.trim()) yield { event: null, data: JSON.parse(line) as unknown };
    }
    return;
  }
  let event: string | null = null;
  let data: string[] = [];
  const dispatch = (): StreamRecord | null => {
    const payload = data.join('\n');
    const rec = data.length && payload !== '[DONE]' ? { event, data: JSON.parse(payload) as unknown } : null;
    event = null;
    data = [];
    return rec;
  };
  for await (const line of splitLines(body)) {
    if (line === '') {
      const rec = dispatch();
      if (rec) yield rec;
    } else if (line.startsWith(':')) {
      continue;
    } else {
      const i = line.indexOf(':');
      const field = i < 0 ? line : line.slice(0, i);
      const value = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
  }
  const tail = dispatch();
  if (tail) yield tail;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** An error record inside an otherwise 200 stream. */
export class StreamError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
  }
}

/** Claude: text from `content_block_delta`/`text_delta`; `error` events throw. */
export function claudeDelta(r: StreamRecord): string | null {
  const d = r.data;
  if (!isObj(d)) return null;
  if (d.type === 'error' || r.event === 'error') {
    const t = isObj(d.error) && typeof d.error.type === 'string' ? d.error.type : 'error';
    throw new StreamError(`stream_${t}`);
  }
  if (d.type !== 'content_block_delta' || !isObj(d.delta) || d.delta.type !== 'text_delta') return null;
  return typeof d.delta.text === 'string' ? d.delta.text : null;
}

/** Gemini: concatenated `candidates[0].content.parts[].text`; an `error` object throws. */
export function geminiDelta(r: StreamRecord): string | null {
  const d = r.data;
  if (!isObj(d)) return null;
  if (isObj(d.error)) throw new StreamError(typeof d.error.code === 'number' ? `stream_http_${d.error.code}` : 'stream_error');
  const cand = Array.isArray(d.candidates) ? d.candidates[0] : undefined;
  const parts = isObj(cand) && isObj(cand.content) && Array.isArray(cand.content.parts) ? cand.content.parts : [];
  const text = parts.map((p) => (isObj(p) && typeof p.text === 'string' ? p.text : '')).join('');
  return text || null;
}

/** Ollama: `message.content` per NDJSON line; an `error` string throws. */
export function ollamaDelta(r: StreamRecord): string | null {
  const d = r.data;
  if (!isObj(d)) return null;
  if (typeof d.error === 'string') throw new StreamError('stream_error');
  const text = isObj(d.message) && typeof d.message.content === 'string' ? d.message.content : '';
  return text || null;
}

// ── Citation gate ────────────────────────────────────────────────────────────────
export interface GateRow {
  feed: string;
  id: string;
  label: string;
}

/** Same grammar as `filterCitations` in ai.ts: `[feed:id]`, feed 2–12 lowercase, id ≤ 160 non-space. */
const MARKER = /\[([a-z]{2,12}):([^\]\s]{1,160})\]/g;
/** A tail that could still grow into a marker. */
const PARTIAL = /\[(?:[a-z]{0,12}|[a-z]{2,12}:[^\]\s]{0,160})$/;

/**
 * Streaming citation safety. Text is released only up to the last `[` that could still open a
 * marker; complete markers are kept only when their id was in the prompt (unknown ids are dropped,
 * never shown), so a client never renders an unverified citation, even transiently.
 */
export class CitationGate {
  private pending = '';
  private readonly byKey: Map<string, GateRow>;
  readonly cited = new Map<string, GateRow>();

  constructor(allowed: readonly GateRow[]) {
    this.byKey = new Map(allowed.map((r) => [`${r.feed}:${r.id}`, r]));
  }

  /** Last character released, so a dropped marker never leaves a double space across deltas. */
  private last = '';

  private clean(s: string): string {
    let dropped = false;
    let out = s.replace(MARKER, (_m, feed: string, id: string) => {
      const row = this.byKey.get(`${feed}:${id}`);
      if (!row) {
        dropped = true;
        return '';
      }
      this.cited.set(`${feed}:${id}`, row);
      return `[${feed}:${id}]`;
    });
    if (dropped) {
      out = out.replace(/[ \t]{2,}/g, ' ');
      if (this.last === ' ' && out.startsWith(' ')) out = out.slice(1);
    }
    if (out) this.last = out.at(-1)!;
    return out;
  }

  /** Feed a delta; returns the text that is safe to forward now (may be ''). */
  push(delta: string): string {
    const buf = this.pending + delta;
    const m = PARTIAL.exec(buf);
    const cut = m ? m.index : buf.length;
    this.pending = buf.slice(cut);
    return this.clean(buf.slice(0, cut));
  }

  /** End of stream: release what is left; an unfinished `[feed:…` marker is dropped, never shown. */
  flush(): string {
    const rest = /^\[[a-z]{2,12}:/.test(this.pending) ? '' : this.clean(this.pending);
    this.pending = '';
    return rest;
  }

  citations(): GateRow[] {
    return [...this.cited.values()];
  }
}
