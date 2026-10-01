/**
 * CISA Known Exploited Vulnerabilities + NVD CVSS enrichment (/api/cyber-threats). Owner:
 * layers-threats-network. Server-only.
 *
 * Probed 2026-09-30: KEV JSON 200 in 0.46 s (1.7 MB, 1 730 entries, catalogVersion 2026.09.30,
 * ETag + Last-Modified, no CORS). NVD 2.0 `cves/2.0?cveId=` 200 in 0.43 s (ACAO *); keyless limit
 * 5 requests / 30 s (the bucket below; NVD_API_KEY raises it to 50 / 30 s and goes in the `apiKey`
 * header, never the URL). Each refresh starts a background batch scoring the newest not-yet-scored
 * CVEs within that budget (5 unkeyed / 40 keyed) and serves KEV immediately with the scores known so
 * far: a cold response never waits on NVD (R3 round-2 m5; was 24.5 s). Scores land in the next
 * snapshot; `providers.nvd` says `error: 'pending'` while a batch is in flight.
 */
import 'server-only';
import { hasCapability } from '@/lib/capabilities';
import { defineFeed, runProvider, type ProviderRun } from '@/lib/feeds';
import { errorReason, httpJson } from '@/lib/http';
import { nvdBucket } from '@/lib/ratelimit';
import type { KevEntry } from '@/lib/types';

export const KEV_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';
export const NVD_URL = 'https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=';

interface KevRaw {
  cveID: string;
  vendorProject?: string;
  product?: string;
  vulnerabilityName?: string;
  dateAdded?: string;
  dueDate?: string;
  knownRansomwareCampaignUse?: string;
  shortDescription?: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseKev(raw: { vulnerabilities?: KevRaw[] }): KevEntry[] {
  const out: KevEntry[] = [];
  for (const v of raw.vulnerabilities ?? []) {
    if (!/^CVE-\d{4}-\d{4,}$/.test(v.cveID ?? '') || !DATE.test(v.dateAdded ?? '')) continue;
    out.push({
      cveId: v.cveID,
      vendor: v.vendorProject ?? '',
      product: v.product ?? '',
      name: v.vulnerabilityName ?? v.cveID,
      dateAdded: v.dateAdded!,
      dueDate: DATE.test(v.dueDate ?? '') ? v.dueDate! : null,
      ransomware: v.knownRansomwareCampaignUse === 'Known' ? 'Known' : 'Unknown',
      description: v.shortDescription ?? '',
    });
  }
  return out.sort((a, b) => b.dateAdded.localeCompare(a.dateAdded) || b.cveId.localeCompare(a.cveId));
}

interface NvdMetric {
  cvssData?: { baseScore?: number; baseSeverity?: string; version?: string };
  baseSeverity?: string;
}

export function nvdScore(body: { vulnerabilities?: { cve?: { metrics?: Record<string, NvdMetric[]> } }[] }): { score: number; severity: string | null; version: string } | null {
  const m = body.vulnerabilities?.[0]?.cve?.metrics ?? {};
  for (const key of ['cvssMetricV40', 'cvssMetricV31', 'cvssMetricV30', 'cvssMetricV2']) {
    const x = m[key]?.[0];
    const s = x?.cvssData?.baseScore;
    if (typeof s === 'number') return { score: s, severity: x?.cvssData?.baseSeverity ?? x?.baseSeverity ?? null, version: x?.cvssData?.version ?? key.replace('cvssMetricV', '') };
  }
  return null;
}

type Score = { score: number; severity: string | null; version: string } | null;

const G = globalThis as unknown as {
  __godseyeNvd?: Map<string, Score>;
  __godseyeNvdJob?: { running: Promise<void> | null; last: { ok: boolean; ms: number; at: number | null; error?: string } | null };
};
const scores = (G.__godseyeNvd ??= new Map());
const job = (G.__godseyeNvdJob ??= { running: null, last: null });

/** Upper bound for one background batch (keyless: 5 lookups fit one 30 s bucket window). */
const NVD_BATCH_DEADLINE_MS = 120_000;

/**
 * Score `cveIds` in the background through the shared nvdBucket, one batch at a time. The feed run
 * never awaits it. Returns the running batch (tests await it).
 */
export function startNvdBatch(cveIds: readonly string[], keyed: boolean): Promise<void> | null {
  if (job.running || cveIds.length === 0) return job.running;
  const t0 = Date.now();
  const signal = AbortSignal.timeout(NVD_BATCH_DEADLINE_MS);
  job.running = (async () => {
    try {
      const bucket = nvdBucket(keyed);
      for (const id of cveIds) {
        const res = await httpJson<Parameters<typeof nvdScore>[0]>(`${NVD_URL}${id}`, {
          signal,
          timeoutMs: 15_000,
          retries: 0,
          limiter: bucket,
          headers: keyed ? { apiKey: process.env.NVD_API_KEY ?? '' } : {},
        });
        scores.set(id, nvdScore(res.data ?? {}));
      }
      job.last = { ok: true, ms: Date.now() - t0, at: Date.now() };
    } catch (e) {
      job.last = { ok: false, ms: Date.now() - t0, at: job.last?.at ?? null, error: errorReason(e) };
    } finally {
      job.running = null;
    }
  })();
  return job.running;
}

/** The in-flight background batch, if any (tests). */
export const nvdBatchInFlight = (): Promise<void> | null => job.running;

/** Forget cached scores and the last batch result (tests start cold). */
export function clearNvdScores(): void {
  scores.clear();
  job.last = null;
}

/** providers.nvd for a snapshot: scores served so far, and whether a batch is still running. */
export function nvdStatus(enriched: number, now = Date.now()): ProviderRun {
  const last = job.last;
  if (job.running) {
    return { status: { ok: enriched > 0, count: enriched, ms: last?.ms ?? 0, age_s: null, error: 'pending' }, okAt: last?.at ?? null };
  }
  if (last && !last.ok) {
    return { status: { ok: false, count: enriched, ms: last.ms, age_s: null, error: last.error ?? 'error' }, okAt: last.at };
  }
  return { status: { ok: true, count: enriched, ms: last?.ms ?? 0, age_s: null }, okAt: last?.at ?? (enriched > 0 ? now : null) };
}

export const kevFeed = defineFeed<{ items: KevEntry[]; catalogVersion: string | null; enriched: number }>({
  key: 'cyber-threats',
  ttlMs: 60 * 60_000,
  pollMs: 10 * 60_000,
  kind: 'live',
  attribution: [
    { text: 'CISA Known Exploited Vulnerabilities Catalog', url: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog', licence: 'Public domain (US Government)' },
    { text: 'CVSS scores: NIST National Vulnerability Database', url: 'https://nvd.nist.gov/', licence: 'Public domain; not endorsed by NVD' },
  ],
  note: 'CVSS scores are fetched from NVD in the background within its rate limit; new scores appear on the next refresh.',
  count: (d) => d.items.length,
  deadlineMs: 60_000,
  run: async ({ signal }) => {
    let version: string | null = null;
    let released: number | null = null;
    const kev = await runProvider(
      async () => {
        const res = await httpJson<{ vulnerabilities?: KevRaw[]; catalogVersion?: string; dateReleased?: string }>(KEV_URL, { signal, timeoutMs: 30_000 });
        version = res.data?.catalogVersion ?? null;
        released = res.data?.dateReleased ? Date.parse(res.data.dateReleased) || null : null;
        return parseKev(res.data ?? {});
      },
      (r) => r.length,
    );
    const items = kev.result ?? [];
    const keyed = hasCapability('nvd');
    const todo = items.filter((k) => !scores.has(k.cveId)).slice(0, keyed ? 40 : 5);
    startNvdBatch(
      todo.map((k) => k.cveId),
      keyed,
    );
    let enriched = 0;
    const out = items.map((k) => {
      const s = scores.get(k.cveId);
      if (s === undefined) return k;
      enriched++;
      return { ...k, cvssScore: s?.score ?? null, cvssSeverity: s?.severity ?? null, cvssVersion: s?.version ?? null };
    });
    return { data: { items: out, catalogVersion: version, enriched }, providers: { cisa_kev: kev.run, nvd: nvdStatus(enriched) }, observedAt: released };
  },
});
