/**
 * GODSEYE SDK ingest + stream. Owner: layers-threats-network. Server-only.
 *
 * POST /api/sdk/ingest accepts a batch of third-party entities:
 *  - fail-closed: without SDK_INGEST_KEY the endpoint answers 503 and accepts nothing;
 *  - `Authorization: Bearer <key>` compared with crypto.timingSafeEqual over SHA-256 digests
 *    (equal-length buffers, so neither the key's length nor content leaks through timing);
 *  - body capped at MAX_BODY_BYTES (read incrementally, the stream is cancelled past the cap);
 *  - every entity validated with zod (SdkEntityInput); invalid ones are rejected individually;
 *  - every stored entity is labelled THIRD-PARTY (SDK) and stamped `ingestedAt`.
 * Accepted entities fan out on the `sdk` SSE hub (`update` events; `snapshot` on connect).
 */
import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { z } from 'zod';
import { getHub } from '@/lib/sse';
import { type SdkEntity, SdkEntityInput, SdkIngestBatch } from '@/lib/schemas/network';

export type SdkEntityT = z.infer<typeof SdkEntity>;

export const MAX_BODY_BYTES = 256 * 1024;
const MAX_ENTITIES = 10_000;
const TTL_MS = 15 * 60_000;

const G = globalThis as unknown as { __godseyeSdk?: Map<string, SdkEntityT> };
const store = (G.__godseyeSdk ??= new Map());

const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest();

/** Constant-time Bearer check. False when no key is configured (fail-closed). */
export function authorized(header: string | null, key: string | undefined = process.env.SDK_INGEST_KEY): boolean {
  if (!key || !key.trim()) return false;
  const m = /^Bearer (\S+)$/.exec(header ?? '');
  const given = digest(m?.[1] ?? '');
  const ok = timingSafeEqual(given, digest(key.trim()));
  return ok && m !== null;
}

/** Read at most `max` bytes of the request body; null when it is larger. */
export async function readCapped(req: Request, max = MAX_BODY_BYTES): Promise<string | null> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > max) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function prune(now = Date.now()) {
  for (const [id, e] of store) if (now - Date.parse(e.ingestedAt) > TTL_MS) store.delete(id);
  while (store.size > MAX_ENTITIES) store.delete(store.keys().next().value!);
}

export function sdkSnapshot(): { entities: SdkEntityT[]; at: string } {
  prune();
  return { entities: [...store.values()], at: new Date().toISOString() };
}

export const sdkHub = () => getHub('sdk', sdkSnapshot);

/** Validate and store one parsed batch. Pure except for the store + broadcast. */
export function ingest(body: unknown): { accepted: number; rejected: number; errors: string[] } {
  const batch = SdkIngestBatch.safeParse(body);
  if (!batch.success) return { accepted: 0, rejected: 0, errors: ['body must be {"entities": [...]} with 1–500 entities'] };
  const now = new Date().toISOString();
  const accepted: SdkEntityT[] = [];
  const errors: string[] = [];
  batch.data.entities.forEach((raw, i) => {
    const r = SdkEntityInput.safeParse(raw);
    if (!r.success) {
      if (errors.length < 20) errors.push(`entities[${i}]: ${r.error.issues[0]?.path.join('.') || 'entity'} ${r.error.issues[0]?.message ?? 'invalid'}`);
      return;
    }
    const e: SdkEntityT = { ...r.data, thirdParty: true, label: 'THIRD-PARTY (SDK)', ingestedAt: now };
    store.delete(e.id);
    store.set(e.id, e);
    accepted.push(e);
  });
  prune();
  if (accepted.length) sdkHub().broadcast('update', { entities: accepted, at: now });
  return { accepted: accepted.length, rejected: batch.data.entities.length - accepted.length, errors };
}

/** Test hook. */
export function resetSdk(): void {
  store.clear();
}
