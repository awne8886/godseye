/**
 * Security round-5 M-1 (ported from the reviewer's kev-etag repro): enrichKev() merges NVD scores
 * into the KEV snapshot at response time, but the ETag covered only (feed, fetchedAt, state, query).
 * Clients revalidate every poll (`cache: 'no-cache'`), so a 304 handed the browser its old body
 * although scores had landed since. The ETag now carries a digest of the merged enrichment.
 * KEV rows: two real entries' ids from the 2026-09-30 catalogue shape; no network.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseKev } from '@/features/network/server/kev';
import type * as Kev from '@/features/network/server/kev';

const kevGet = vi.fn();
vi.mock('@/features/network/server/kev', async (orig) => {
  const actual = await orig<typeof Kev>();
  return { ...actual, kevFeed: { get: () => kevGet() } };
});

const items = parseKev({
  vulnerabilities: [
    { cveID: 'CVE-2026-11111', vendorProject: 'V', product: 'P', vulnerabilityName: 'A', dateAdded: '2026-09-30' },
    { cveID: 'CVE-2026-22222', vendorProject: 'V', product: 'P', vulnerabilityName: 'B', dateAdded: '2026-09-29' },
  ],
});
const fetchedAt = '2026-10-01T12:00:00.000Z';
const snapshot = () => ({
  data: { items, catalogVersion: '2026.09.30', enriched: 0 },
  meta: { feed: 'cyber-threats', kind: 'live', fetchedAt, observedAt: fetchedAt, state: 'live', stale: false, ttlSeconds: 3600, lastGoodAt: fetchedAt, attribution: [] },
  providers: { cisa_kev: { ok: true, count: 2, ms: 1, age_s: 0 } },
});
const G = globalThis as unknown as { __godseyeNvdScores?: Map<string, unknown>; __godseyeNvdQueue?: { queue: string[]; last: unknown } };
let n = 0;
const req = (h: Record<string, string> = {}, q = '?limit=2') => new Request(`http://localhost/api/cyber-threats${q}`, { headers: { 'x-forwarded-for': `192.0.2.${++n % 250}`, ...h } });

afterEach(() => {
  G.__godseyeNvdScores?.clear();
  if (G.__godseyeNvdQueue) {
    G.__godseyeNvdQueue.queue.length = 0;
    G.__godseyeNvdQueue.last = null;
  }
});

describe('/api/cyber-threats ETag reflects what the body says', () => {
  it('a CVSS score merged after the first response is never hidden behind a 304', async () => {
    kevGet.mockResolvedValue(snapshot());
    const { GET } = await import('./route');
    const a = await GET(req(), undefined as never);
    expect(a.status).toBe(200);
    const bodyA = (await a.json()) as { items: { cvssScore?: number | null }[]; enriched: number };
    expect(bodyA.enriched).toBe(0);
    expect(bodyA.items[0]!.cvssScore ?? null).toBeNull();
    // Unchanged enrichment: the same ETag, and a revalidation is a 304.
    const same = await GET(req({ 'if-none-match': a.headers.get('etag')! }), undefined as never);
    expect(same.status).toBe(304);
    // NVD answers in the background (what queueNvd() does between KEV refreshes).
    G.__godseyeNvdScores!.set('CVE-2026-11111', { score: { score: 9.8, severity: 'CRITICAL', version: '3.1' }, at: Date.now() });
    const fresh = await GET(req(), undefined as never);
    const bodyB = (await fresh.json()) as { items: { cvssScore?: number | null }[]; enriched: number };
    expect(bodyB.enriched).toBe(1);
    expect(bodyB.items[0]!.cvssScore).toBe(9.8);
    expect(fresh.headers.get('etag'), 'body changed but ETag did not').not.toBe(a.headers.get('etag'));
    const revalidate = await GET(req({ 'if-none-match': a.headers.get('etag')! }), undefined as never);
    expect(revalidate.status).toBe(200);
    expect(((await revalidate.json()) as { enriched: number }).enriched).toBe(1);
  });

  it('a changed NVD queue state changes the ETag even before any score lands', async () => {
    kevGet.mockResolvedValue(snapshot());
    const { GET } = await import('./route');
    const idle = await GET(req(), undefined as never);
    G.__godseyeNvdQueue!.queue.push('CVE-2026-11111', 'CVE-2026-22222');
    const queued = await GET(req({ 'if-none-match': idle.headers.get('etag')! }), undefined as never);
    expect(queued.status).toBe(200);
    const body = (await queued.json()) as { nvd: { queued: number; etaS: number | null }; providers: { nvd: { error?: string } } };
    expect(body.nvd).toMatchObject({ queued: 2, etaS: 12 });
    expect(body.providers.nvd.error).toBe('queued');
    // A refused lookup (same scores, new provider status) is a new body too.
    G.__godseyeNvdQueue!.queue.length = 0;
    G.__godseyeNvdQueue!.last = { ok: false, ms: 5, at: null, error: 'http_503' };
    const refused = await GET(req({ 'if-none-match': queued.headers.get('etag')! }), undefined as never);
    expect(refused.status).toBe(200);
    expect(refused.headers.get('etag')).not.toBe(idle.headers.get('etag'));
  });

  it('the query is still part of the variant (?limit slices differ)', async () => {
    kevGet.mockResolvedValue(snapshot());
    const { GET } = await import('./route');
    const one = await GET(req({}, '?limit=1'), undefined as never);
    const two = await GET(req({}, '?limit=2'), undefined as never);
    expect(one.headers.get('etag')).not.toBe(two.headers.get('etag'));
  });

  it('an offline KEV snapshot is a 503 that no If-None-Match can turn into a 304', async () => {
    kevGet.mockResolvedValue({ ...snapshot(), data: null, meta: { ...snapshot().meta, state: 'offline' } });
    const { GET } = await import('./route');
    const res = await GET(req({ 'if-none-match': '*' }), undefined as never);
    expect(res.status).toBe(503);
  });
});
