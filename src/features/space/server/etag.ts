/**
 * HTTP validators for GET /api/satellites (perf round 5 m-i). The weak ETag depends on what the
 * body SAYS — snapshot times, state, provider outcomes, the next CelesTrak retry — and never on the
 * clock, so revalidating an unchanged 2.6 MB catalogue is a bodiless 304. Providers' relative
 * `age_s` is left out on purpose: bodies that differ only in it are semantically equivalent (a weak
 * validator, RFC 9110 §8.8.1), and `meta` carries the absolute times. Pure. Owner: layers-space.
 */
import type { FeedMeta, Providers } from '@/lib/types';

export type VersionedMeta = Pick<FeedMeta, 'fetchedAt' | 'observedAt' | 'lastGoodAt' | 'state' | 'stale' | 'ttlSeconds'>;

/** Content version of a satellites response: everything but providers' `age_s` (and the clock). */
export function contentVersion(meta: VersionedMeta, providers: Providers, retryAt: number | null): string {
  const outcomes = Object.keys(providers)
    .sort()
    .map((name) => {
      const p = providers[name]!;
      return [name, p.ok ? 1 : 0, p.count, p.ms, p.error ?? '', p.skipped ?? ''].join(':');
    })
    .join(',');
  return [meta.fetchedAt, meta.observedAt, meta.lastGoodAt, meta.state, meta.stale ? 1 : 0, meta.ttlSeconds, retryAt ?? '', outcomes].join('|');
}

/** True when If-None-Match names `etag` (weak comparison, RFC 9110 §13.1.2) or is `*`. */
export function revalidates(req: Request, etag: string): boolean {
  const inm = req.headers.get('if-none-match');
  if (!inm) return false;
  if (inm.trim() === '*') return true;
  const want = etag.replace(/^W\//, '');
  return inm.split(',').some((t) => t.trim().replace(/^W\//, '') === want);
}
