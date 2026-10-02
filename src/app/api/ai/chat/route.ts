/**
 * POST /api/ai/chat {messages, provider?} — analyst chat over the current feeds, streamed as NDJSON:
 *   {"type":"meta","generatedBy","model","fallbackReason","keySource"}
 *   {"type":"delta","text"} …
 *   {"type":"done","citations","timestamp","truncated"}
 * Model answers are true token streams (`streamModel()` over httpStream): `meta` goes out when the
 * first model delta arrives and each delta is forwarded as it comes, after the citation gate has
 * released it (a `[feed:id]` marker is shown only once complete and only if the id was in the
 * prompt). A model that fails before its first delta falls back to the ANALYST (a keyword match
 * over the feed, labelled ANALYST — never AI) and `meta.fallbackReason` says why; a failure after
 * text was sent ends with `done.truncated` = the reason. Always `no-store`; the visitor key is never
 * echoed or logged. Owner: panels-alerts-markets-dossier-graph.
 */
import { z } from 'zod';
import { chatPrompt, readSnapshot } from '@/components/panels/intel/server/ai-context';
import { answerStream, selectProvider, type ChatEvent } from '@/components/panels/intel/server/ai';
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

/** Wire shape of one event (citation labels capped at 200 chars). */
function line(e: ChatEvent): string {
  const out = e.type === 'done' ? { ...e, citations: e.citations.map((c) => ({ feed: c.feed, id: c.id, label: c.label.slice(0, 200) })) } : e;
  return `${JSON.stringify(out)}\n`;
}

export const POST = withRoute('/api/ai/chat', async (req) => {
  const b = await readBody(req, Body);
  if (!b.ok) return b.response;
  const prompt = chatPrompt(b.data.messages, await readSnapshot());
  const events = answerStream(selectProvider(b.data.provider, userKeyFrom(req)), prompt, process.env, req.signal);
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await events.next();
      if (next.done) controller.close();
      else controller.enqueue(enc.encode(line(next.value)));
    },
    async cancel() {
      await events.return(undefined);
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': cacheControl(0), Vary: 'x-ai-key', 'X-Accel-Buffering': 'no' } });
});
