/**
 * Shared plumbing for the RECON lookups (/api/osint/*, /api/scanner, /api/geo*, /api/directions,
 * /api/arcgis): per-query caching in the SnapshotStore, honest per-provider status, and the
 * OsintResponse envelope. Every lookup reports which provider answered, when, and which failed.
 * Owner: panels-recon. Server-only.
 */
import 'server-only';
import { getStore } from '@/lib/cache';
import { errorReason } from '@/lib/http';
import { apiError, json } from '@/lib/respond';
import type { OsintResponse, ProviderStatus, Providers } from '@/lib/types';

export type OsintTool = OsintResponse['tool'];
export type Finding = OsintResponse['findings'][number];

export interface Probe<T> {
  value: T | null;
  status: ProviderStatus;
  /** ms epoch the value was fetched upstream (cached answers keep their original time). */
  fetchedAt: number | null;
}

export interface ProbeOptions<T> {
  /** Records contributed (0 → `empty` unless allowEmpty). */
  count?: (v: T) => number;
  /** "Nothing found" is a truthful answer for this provider (no breaches, not a Tor exit…). */
  allowEmpty?: boolean;
  /** Skip the cache (tests, or answers that must be fresh). */
  noCache?: boolean;
}

const status = (ok: boolean, count: number, ms: number, ageS: number | null, error?: string): ProviderStatus => ({
  ok,
  count,
  ms,
  age_s: ageS,
  ...(error ? { error } : {}),
});

/**
 * Run one provider through a per-key cache. Fresh cache hits report `ms: 0` and their real age;
 * failures are never cached (the next request tries again) and never become empty "truth".
 */
export async function probe<T>(key: string, ttlMs: number, fn: () => Promise<T>, opts: ProbeOptions<T> = {}): Promise<Probe<T>> {
  const count = opts.count ?? (() => 1);
  const store = getStore();
  const cacheKey = `recon:${key}`;
  if (!opts.noCache) {
    const hit = await store.get<T>(cacheKey).catch(() => null);
    if (hit && hit.error === null && Date.now() - hit.fetchedAt < ttlMs) {
      const n = count(hit.data);
      return { value: hit.data, status: status(true, n, 0, Math.round((Date.now() - hit.fetchedAt) / 1000)), fetchedAt: hit.fetchedAt };
    }
  }
  const t0 = Date.now();
  try {
    const value = await fn();
    const n = count(value);
    const ok = n > 0 || opts.allowEmpty === true;
    if (!ok) return { value, status: status(false, 0, Date.now() - t0, null, 'empty'), fetchedAt: null };
    const now = Date.now();
    if (!opts.noCache) await store.set(cacheKey, { data: value, fetchedAt: now, lastAttemptAt: now, error: null }, ttlMs).catch(() => undefined);
    return { value, status: status(true, n, now - t0, 0), fetchedAt: now };
  } catch (e) {
    return { value: null, status: status(false, 0, Date.now() - t0, null, errorReason(e)), fetchedAt: null };
  }
}

/** A provider that did not run (missing key, licence gate, budget). */
export function skipped(reason: NonNullable<ProviderStatus['skipped']>): ProviderStatus {
  return { ok: false, count: 0, ms: 0, age_s: null, skipped: reason };
}

export const anyOk = (providers: Providers) => Object.values(providers).some((p) => p.ok);

export function osintBody(tool: OsintTool, query: string, data: Record<string, unknown>, findings: Finding[], providers: Providers): OsintResponse {
  return { tool, query, data, findings, providers, timestamp: new Date().toISOString() };
}

/**
 * Respond with an OSINT envelope, or an honest 503 naming each provider's status when none answered
 * (never an empty result pretending nothing was found).
 */
export function osintJson(body: OsintResponse, ttl: number): Response {
  if (!anyOk(body.providers)) return offline(body.providers, `No provider answered for ${body.tool}.`);
  return json(body, { ttl });
}

/** 503 SOURCE OFFLINE with the provider list (not cached anywhere). */
export function offline(providers: Providers, detail: string): Response {
  const skippedOnly = Object.values(providers).length > 0 && Object.values(providers).every((p) => p.skipped);
  if (skippedOnly) {
    return json({ error: 'not_configured', detail, providers }, { status: 503, ttl: 0, headers: { 'Retry-After': '3600' } });
  }
  return json({ error: 'source_offline', detail, providers, retryAfter: 30 }, { status: 503, ttl: 0, headers: { 'Retry-After': '30' } });
}

export { apiError };
