/** perf round 5 m-i: the satellites validator follows the content, never the clock. */
import { describe, expect, it } from 'vitest';
import type { Providers } from '@/lib/types';
import { contentVersion, revalidates, type VersionedMeta } from './etag';

const meta: VersionedMeta = {
  fetchedAt: '2026-10-01T15:04:33Z',
  observedAt: '2026-10-01T10:28:49Z',
  lastGoodAt: '2026-10-01T15:04:33Z',
  state: 'live',
  stale: false,
  ttlSeconds: 7200,
};
const providers: Providers = {
  celestrak: { ok: true, count: 16_638, ms: 5200, age_s: 0 },
  'celestrak-groups': { ok: true, count: 529, ms: 9100, age_s: 0 },
};

describe('contentVersion', () => {
  const v = contentVersion(meta, providers, null);

  it('ignores providers’ relative age_s (bodies that differ only in it are equivalent)', () => {
    const older = { celestrak: { ...providers.celestrak!, age_s: 150 }, 'celestrak-groups': { ...providers['celestrak-groups']!, age_s: 150 } };
    expect(contentVersion(meta, older, null)).toBe(v);
    // Key order does not matter either.
    expect(contentVersion(meta, { 'celestrak-groups': providers['celestrak-groups']!, celestrak: providers.celestrak! }, null)).toBe(v);
  });

  it('changes with the snapshot, its state and freshness', () => {
    expect(contentVersion({ ...meta, fetchedAt: '2026-10-01T17:04:33Z' }, providers, null)).not.toBe(v);
    expect(contentVersion({ ...meta, state: 'recent' }, providers, null)).not.toBe(v);
    expect(contentVersion({ ...meta, stale: true }, providers, null)).not.toBe(v);
    expect(contentVersion({ ...meta, lastGoodAt: '2026-10-01T13:04:33Z' }, providers, null)).not.toBe(v);
  });

  it('changes with a provider outcome and with the next CelesTrak retry', () => {
    const failed: Providers = { ...providers, celestrak: { ok: false, count: 0, ms: 30_000, age_s: null, error: 'timeout' } };
    expect(contentVersion(meta, failed, null)).not.toBe(v);
    expect(contentVersion(meta, providers, Date.parse('2026-10-01T15:30:00Z'))).not.toBe(v);
  });
});

describe('revalidates', () => {
  const etag = 'W/"abc"';
  const r = (inm?: string) => new Request('http://localhost/api/satellites', inm ? { headers: { 'if-none-match': inm } } : {});

  it('weak-compares every listed validator', () => {
    expect(revalidates(r('W/"abc"'), etag)).toBe(true);
    expect(revalidates(r('"abc"'), etag)).toBe(true);
    expect(revalidates(r('W/"x", W/"abc"'), etag)).toBe(true);
    expect(revalidates(r('*'), etag)).toBe(true);
    expect(revalidates(r('W/"abcd"'), etag)).toBe(false);
    expect(revalidates(r(), etag)).toBe(false);
  });
});
