/**
 * POST /api/ai/chat {messages, provider?} — analyst chat over the current feeds, streamed as NDJSON:
 *   {"type":"meta","generatedBy","model","fallbackReason","keySource"}
 *   {"type":"delta","text"} …
 *   {"type":"done","citations","timestamp"}
 * The model call itself is buffered (src/lib/http.ts has no streaming reader); the answer is then
 * streamed to the client in chunks. The ANALYST (keyword match over the feed) answers when no model
 * is available and says so in `meta`. Always `no-store`; the visitor key is never echoed or logged.
 * Owner: panels-alerts-markets-dossier-graph.
 */
import { z } from 'zod';
import { chatPrompt, readSnapshot } from '@/components/panels/intel/server/ai-context';
import { answer, selectProvider } from '@/components/panels/intel/server/ai';
import { PreferenceSchema, readBody, userKeyFrom } from '@/components/panels/intel/server/ai-route';
import { cacheControl, withRoute } from '@/lib/respond';

export const dynamic = 'force-dynamic';

const Body = z.object({
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(2000) }))
    .min(1)
    .max(12)
    .refine((m) => m.at(-1)?.role === 'user', 'the last message must be from the user'),
  provider: PreferenceSchema,
});

/** Split into ~word-boundary chunks for progressive rendering. */
function chunks(text: string, size = 48): string[] {
  const out: string[] = [];
  let buf = '';
  for (const part of text.split(/(\s+)/)) {
    buf += part;
    if (buf.length >= size) {
      out.push(buf);
      buf = '';
    }
  }
  if (buf) out.push(buf);
  return out;
}

export const POST = withRoute('/api/ai/chat', async (req) => {
  const b = await readBody(req, Body);
  if (!b.ok) return b.response;
  const prompt = chatPrompt(b.data.messages, await readSnapshot());
  const r = await answer(selectProvider(b.data.provider, userKeyFrom(req)), prompt, process.env, req.signal);
  const enc = new TextEncoder();
  const lines = [
    { type: 'meta', generatedBy: r.generatedBy, model: r.model, fallbackReason: r.fallbackReason, keySource: r.keySource },
    ...chunks(r.text).map((text) => ({ type: 'delta', text })),
    { type: 'done', citations: r.citations.map((c) => ({ feed: c.feed, id: c.id, label: c.label.slice(0, 200) })), timestamp: new Date().toISOString() },
  ];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const l of lines) controller.enqueue(enc.encode(`${JSON.stringify(l)}\n`));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': cacheControl(0), Vary: 'x-ai-key' } });
});
