/**
 * Shared POST handling for /api/ai/*: body parsing (≤ 32 KB, zod), the visitor key from the
 * `x-ai-key` header (used for this request only — never stored, cached, logged or echoed), provider
 * preference from Settings, and `no-store` responses. Rate limiting (shared fail-closed `ai`
 * bucket, 5 per 60 s) comes from the catalogue through withRoute().
 * Owner: panels-alerts-markets-dossier-graph. Server-only.
 */
import 'server-only';
import { z } from 'zod';
import { apiError, json } from '@/lib/respond';
import type { AiOverviewResponse } from '@/lib/types';
import { answer, selectProvider, type AiResult, type Preference } from './ai';
import type { Prompt } from './ai-context';

export const MAX_BODY_BYTES = 32 * 1024;
export const PreferenceSchema = z.enum(['auto', 'claude', 'gemini', 'ollama', 'analyst']).default('auto');

/** The visitor key, if any (trimmed, length-capped). Never log the return value. */
export function userKeyFrom(req: Request): string | null {
  const k = req.headers.get('x-ai-key')?.trim();
  return k && k.length >= 10 && k.length <= 300 && /^[\x21-\x7e]+$/.test(k) ? k : null;
}

export async function readBody<S extends z.ZodType>(req: Request, schema: S): Promise<{ ok: true; data: z.infer<S> } | { ok: false; response: Response }> {
  const len = Number(req.headers.get('content-length') ?? '0');
  if (len > MAX_BODY_BYTES) return { ok: false, response: apiError(413, 'payload_too_large', `Body exceeds ${MAX_BODY_BYTES} bytes.`) };
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return { ok: false, response: apiError(400, 'invalid_request', 'Unreadable body.') };
  }
  if (raw.length > MAX_BODY_BYTES) return { ok: false, response: apiError(413, 'payload_too_large', `Body exceeds ${MAX_BODY_BYTES} bytes.`) };
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    return { ok: false, response: apiError(400, 'invalid_request', 'Body must be JSON.') };
  }
  const r = schema.safeParse(parsed);
  if (!r.success) return { ok: false, response: apiError(400, 'invalid_request', r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ')) };
  return { ok: true, data: r.data };
}

export function toResponseBody(r: AiResult, brief?: Prompt['brief']): AiOverviewResponse {
  return {
    generatedBy: r.generatedBy,
    model: r.model,
    fallbackReason: r.fallbackReason,
    keySource: r.keySource,
    text: r.text,
    citations: r.citations.map((c) => ({ feed: c.feed, id: c.id, label: c.label.slice(0, 200) })),
    timestamp: new Date().toISOString(),
    ...(brief ? { brief } : {}),
  };
}

/** Run the prompt through the selected provider (or the ANALYST) and answer `no-store`. */
export async function respondAi(req: Request, pref: Preference, prompt: Prompt): Promise<Response> {
  const choice = selectProvider(pref, userKeyFrom(req));
  const r = await answer(choice, prompt, process.env, req.signal);
  return json(toResponseBody(r, prompt.brief), { ttl: 0, headers: { Vary: 'x-ai-key' } });
}
