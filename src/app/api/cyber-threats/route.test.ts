import type * as Http from '@/lib/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FX, type Answer, type Call, type Route } from '@/features/threats/server/__fixtures__';
import { freshCache, req, resetCache } from '@/features/threats/server/__fixtures__/routes';
import { clearNvdScores, kevFeed, nvdBatchInFlight, nvdProgress, nvdProviderStatus, queueNvd } from '@/features/network/server/kev';
import { KevResponse } from '@/lib/schemas';
import { GET } from './route';

const state = vi.hoisted(() => ({ routes: [] as Route[], calls: [] as Call[] }));
vi.mock('@/lib/http', async (importOriginal) => {
  const orig = await importOriginal<typeof Http>();
  const { httpMock } = await import('@/features/threats/server/__fixtures__');
  return { ...orig, ...httpMock(() => state.routes, orig.HttpError, state.calls) };
});

/** CISA as probed 2026-10-01: 304 when If-None-Match and If-Modified-Since both match. */
const kevConditional: Answer = (_url, opts) => (opts.etag && opts.lastModified ? 304 : FX.kev);
const kevCalls = () => state.calls.filter((c) => c.url.includes('known_exploited_vulnerabilities.json'));
const nvdCalls = () => state.calls.filter((c) => c.url.includes('services.nvd.nist.gov'));

beforeEach(() => {
  freshCache();
  clearNvdScores();
  state.calls.length = 0;
});
afterEach(async () => {
  await nvdBatchInFlight();
  kevFeed.stop();
  resetCache();
});

describe('GET /api/cyber-threats', () => {
  it('serves KEV at once without waiting on NVD; scores appear on the next response (R3 m5)', async () => {
    state.routes = [['known_exploited_vulnerabilities.json', kevConditional], ['services.nvd.nist.gov', FX.nvd]];
    const res = await GET(req('/api/cyber-threats'), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(KevResponse.safeParse(body).success).toBe(true);
    expect(body.items).toHaveLength(30);
    expect(body.catalogVersion).toBe('2026.09.30');
    expect(body.providers.cisa_kev).toMatchObject({ ok: true, count: 30 });
    // Cold: every CVE is either answered or queued at NVD's keyless pace (1 per 6 s), and says so.
    expect(body.nvd.queued).toBeGreaterThan(0);
    expect(body.enriched + body.nvd.queued).toBe(30);
    expect(body.nvd).toMatchObject({ ratePer30s: 5, awaitingAnalysis: 0 });
    expect(body.nvd.etaS).toBe(Math.ceil(body.nvd.queued * 6));
    expect(body.providers.nvd.count).toBe(body.enriched);
    expect(body.meta.observedAt).toBe('2026-09-30T16:59:23.068Z');

    // R3 round-4 MINOR-5: no hour-long "pending" — the next response has the scores. After the
    // batch the snapshot was revalidated with a conditional GET (304): same catalogue, same
    // observation time, a later fetch time.
    await nvdBatchInFlight();
    const next = await (await GET(req('/api/cyber-threats'), undefined)).json();
    expect(KevResponse.safeParse(next).success).toBe(true);
    expect(kevCalls()).toHaveLength(2);
    expect(kevCalls()[1]).toMatchObject({ etag: 'W/"fx"', lastModified: 'Wed, 30 Sep 2026 19:55:39 GMT' });
    expect(Date.parse(next.meta.fetchedAt)).toBeGreaterThanOrEqual(Date.parse(body.meta.fetchedAt));
    expect(next.meta.observedAt).toBe(body.meta.observedAt);
    expect(next.catalogVersion).toBe('2026.09.30');
    expect(next.total).toBe(30);
    expect(next.enriched).toBe(30);
    expect(next.items[0]).toMatchObject({ cvssScore: 10, cvssSeverity: 'CRITICAL' });
    expect(next.providers.nvd).toMatchObject({ ok: true, count: 30 });
    expect(next.providers.nvd.error).toBeUndefined();
    expect(next.nvd).toMatchObject({ queued: 0, etaS: null });
    expect(Date.parse(next.nvd.lastLookupAt)).toBeLessThanOrEqual(Date.now());
    // ?limit merges only the slice it serves, but counts the whole catalogue.
    const lim = await (await GET(req('/api/cyber-threats?limit=2'), undefined)).json();
    expect(lim.items).toHaveLength(2);
    expect(lim.enriched).toBe(30);
  });

  it('states "queued" with the wait at the bucket pace while nothing is scored yet', async () => {
    state.routes = [['services.nvd.nist.gov', FX.nvd]];
    const worker = queueNvd(['CVE-2021-44228', 'CVE-2024-0001', 'CVE-2024-0002'], false);
    // Synchronously after queueing: nothing answered yet.
    expect(nvdProviderStatus(0)).toEqual({ ok: false, count: 0, ms: 0, age_s: null, error: 'queued' });
    expect(nvdProgress(0)).toEqual({ queued: 3, etaS: 18, ratePer30s: 5, lastLookupAt: null, awaitingAnalysis: 0 });
    await worker;
    expect(nvdProgress(0)).toMatchObject({ queued: 0, etaS: null });
    expect(nvdProviderStatus(3)).toMatchObject({ ok: true, count: 3, age_s: 0 });
  });

  it('a failed NVD batch is reported in providers, KEV still served', async () => {
    state.routes = [['known_exploited_vulnerabilities.json', FX.kev], ['services.nvd.nist.gov', 503]];
    expect((await GET(req('/api/cyber-threats'), undefined)).status).toBe(200);
    await nvdBatchInFlight();
    const body = await (await GET(req('/api/cyber-threats'), undefined)).json();
    expect(KevResponse.safeParse(body).success).toBe(true);
    expect(body.providers.cisa_kev.ok).toBe(true);
    // The refusal is reported with its reason; the queue is dropped (re-queued on the next refresh).
    expect(body.providers.nvd).toMatchObject({ ok: false, count: 0, error: 'http_503', age_s: null });
    expect(body.nvd).toMatchObject({ queued: 0, etaS: null, lastLookupAt: null });
  });

  it('?limit=N serves the N newest additions and reports the full total; bad limits are 400', async () => {
    state.routes = [['known_exploited_vulnerabilities.json', FX.kev], ['services.nvd.nist.gov', FX.nvd]];
    const res = await GET(req('/api/cyber-threats?limit=3'), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(KevResponse.safeParse(body).success).toBe(true);
    expect(body.items).toHaveLength(3);
    expect(body.total).toBe(30);
    expect(body.items[0].dateAdded >= body.items[2].dateAdded).toBe(true);
    expect((await GET(req('/api/cyber-threats?limit=0'), undefined)).status).toBe(400);
    expect((await GET(req('/api/cyber-threats?limit=abc'), undefined)).status).toBe(400);
  });

  it('still answers after another module registered the shared NVD bucket first (R3-B1)', async () => {
    const { nvdBucket } = await import('@/lib/ratelimit');
    nvdBucket(false); // what /api/chain/daily and /api/osint/cve register
    state.routes = [['known_exploited_vulnerabilities.json', FX.kev], ['services.nvd.nist.gov', FX.nvd]];
    const res = await GET(req('/api/cyber-threats'), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.providers.cisa_kev.ok).toBe(true);
    expect(body.providers.nvd).toBeDefined();
  });

  // R3 round-5 MINOR-2: health said nvd "queued" long after the route said ok (the snapshot was
  // only restated at the next hourly KEV refresh).
  it('/api/health restates providers.nvd once the queue drained, the same as the route', async () => {
    state.routes = [['known_exploited_vulnerabilities.json', kevConditional], ['services.nvd.nist.gov', FX.nvd]];
    await GET(req('/api/cyber-threats'), undefined);
    await nvdBatchInFlight();
    expect(nvdBatchInFlight()).toBeNull();
    const route = await (await GET(req('/api/cyber-threats'), undefined)).json();
    const health = kevFeed.health();
    expect(route.providers.nvd).toMatchObject({ ok: true, count: 30 });
    expect(health.providers.nvd).toMatchObject({ ok: true, count: 30 });
    expect(health.providers.nvd!.error).toBeUndefined();
    expect(health.state).toBe('live');
    // The revalidation was a 304 (cisa_kev ok, same 30 entries), not a new download.
    expect(health.providers.cisa_kev).toMatchObject({ ok: true, count: 30 });
    expect(health.count).toBe(30);
  });

  it('a refused lookup is restated in health too, and the revalidation queues nothing new', async () => {
    let answered = 0;
    state.routes = [['known_exploited_vulnerabilities.json', kevConditional], ['services.nvd.nist.gov', () => (++answered <= 5 ? FX.nvd : 403)]];
    await GET(req('/api/cyber-threats'), undefined);
    await nvdBatchInFlight();
    expect(nvdCalls()).toHaveLength(6);
    const route = await (await GET(req('/api/cyber-threats'), undefined)).json();
    expect(route.providers.nvd).toMatchObject({ ok: false, count: 5, error: 'http_403' });
    expect(kevFeed.health().providers.nvd).toMatchObject({ ok: false, count: 5, error: 'http_403' });
    // 25 CVEs still need a score, but the post-batch revalidation did not queue them again: NVD is
    // asked at most one batch per KEV refresh (no retry loop against a refusing upstream).
    expect(route.nvd).toMatchObject({ queued: 0, etaS: null });
    expect(nvdBatchInFlight()).toBeNull();
    expect(nvdCalls()).toHaveLength(6);
    expect(kevCalls()).toHaveLength(2);
  });

  it('answers 503 when CISA is unreachable', async () => {
    state.routes = [['known_exploited_vulnerabilities.json', 503]];
    expect((await GET(req('/api/cyber-threats'), undefined)).status).toBe(503);
  });
});
