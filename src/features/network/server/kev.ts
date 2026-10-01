/**
 * CISA Known Exploited Vulnerabilities + NVD CVSS enrichment (/api/cyber-threats). Owner:
 * layers-threats-network. Server-only.
 *
 * Probed 2026-09-30: KEV JSON 200 in 0.46 s (1.7 MB, 1 730 entries, catalogVersion 2026.09.30,
 * ETag + Last-Modified, no CORS). NVD 2.0 `cves/2.0?cveId=` 200 in 0.43 s (ACAO *); keyless limit
 * 5 requests / 30 s (the bucket below; NVD_API_KEY raises it to 50 / 30 s and goes in the `apiKey`
 * header, never the URL). Each refresh queues the newest not-yet-scored CVEs (40 keyless / 400
 * keyed) for a background worker paced by that bucket and serves KEV at once: a cold response never
 * waits on NVD (R3 round-2 m5). Every response merges the scores known at that moment and states
 * the queue (`nvd.queued`, `etaS` at the bucket's pace, `lastLookupAt`), never an open-ended
 * "pending" frozen in an hour-old snapshot (R3 round-4 MINOR-5). CVEs NVD has not analysed yet are
 * asked again after 6 h instead of being cached as unscored for good.
 */
import 'server-only';
import { hasCapability } from '@/lib/capabilities';
import { defineFeed, runProvider, type FeedResult, type ProviderRun } from '@/lib/feeds';
import { errorReason, httpJson } from '@/lib/http';
import { nvdBucket } from '@/lib/ratelimit';
import type { KevEntry, ProviderStatus } from '@/lib/types';

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
/** NVD's answer for one CVE: a score, or null while NVD has not analysed it yet. */
interface Checked {
  score: Score;
  at: number;
}

interface NvdJob {
  running: Promise<void> | null;
  /** CVEs waiting for an nvdBucket slot, newest KEV additions first. */
  queue: string[];
  keyed: boolean;
  /** Last lookup: `at` is the last SUCCESSFUL lookup (the last-good time). */
  last: { ok: boolean; ms: number; at: number | null; error?: string } | null;
}

const G = globalThis as unknown as { __godseyeNvdScores?: Map<string, Checked>; __godseyeNvdQueue?: NvdJob };
const scores = (G.__godseyeNvdScores ??= new Map());
const job = (G.__godseyeNvdQueue ??= { running: null, queue: [], keyed: false, last: null });

/** CVEs queued per KEV refresh: keyless 40 (≈ 4 min at 5 / 30 s), keyed 400 (≈ 4 min at 50 / 30 s). */
export const NVD_PER_REFRESH = { keyless: 40, keyed: 400 } as const;
/** NVD answers "no metrics yet" for CVEs it has not analysed: ask again after this long, not never. */
export const NVD_RECHECK_MS = 6 * 60 * 60_000;

/** True when NVD has never answered for this CVE, or answered "not analysed yet" long enough ago. */
export function needsNvd(cveId: string, now = Date.now()): boolean {
  const c = scores.get(cveId);
  return !c || (c.score === null && now - c.at > NVD_RECHECK_MS);
}

/**
 * Queue `cveIds` for scoring and run the queue in the background, one lookup per nvdBucket slot.
 * The feed run never awaits it; each response merges the scores known at that moment
 * (enrichKev). A refused lookup (rate limit, outage) stops the run and empties the queue: the next
 * KEV refresh queues the remainder again. Returns the running worker (tests await it).
 */
export function queueNvd(cveIds: readonly string[], keyed: boolean): Promise<void> | null {
  for (const id of cveIds) if (!job.queue.includes(id)) job.queue.push(id);
  job.keyed = keyed;
  if (job.running || job.queue.length === 0) return job.running;
  job.running = (async () => {
    const bucket = nvdBucket(keyed);
    try {
      while (job.queue.length > 0) {
        const id = job.queue[0]!;
        const t0 = Date.now();
        try {
          const res = await httpJson<Parameters<typeof nvdScore>[0]>(`${NVD_URL}${id}`, {
            timeoutMs: 15_000,
            retries: 0,
            limiter: bucket,
            headers: keyed ? { apiKey: process.env.NVD_API_KEY ?? '' } : {},
          });
          scores.set(id, { score: nvdScore(res.data ?? {}), at: Date.now() });
          job.last = { ok: true, ms: Date.now() - t0, at: Date.now() };
          job.queue.shift();
        } catch (e) {
          job.last = { ok: false, ms: Date.now() - t0, at: job.last?.at ?? null, error: errorReason(e) };
          job.queue.length = 0;
        }
      }
    } finally {
      job.running = null;
    }
  })();
  return job.running;
}

/** The in-flight background worker, if any (tests). */
export const nvdBatchInFlight = (): Promise<void> | null => job.running;

/** Forget cached scores, the queue and the last lookup (tests start cold). */
export function clearNvdScores(): void {
  scores.clear();
  job.queue.length = 0;
  job.last = null;
}

export interface NvdProgress {
  queued: number;
  etaS: number | null;
  ratePer30s: number;
  lastLookupAt: string | null;
  awaitingAnalysis: number;
}

/**
 * providers.nvd as it is NOW (R3 round-4 MINOR-5: a snapshot said "pending" for up to an hour).
 * Lookups waiting for a rate-limit slot are `queued` (with the wait in NvdProgress); a refused
 * lookup reports its reason; `age_s` is the age of the last successful lookup (the last-good time).
 * Not ok only while nothing has been scored yet or when the last lookup failed.
 */
export function nvdProviderStatus(enriched: number, now = Date.now()): ProviderStatus {
  const last = job.last;
  const age_s = last?.at ? Math.max(0, Math.round((now - last.at) / 1000)) : null;
  const ms = last?.ms ?? 0;
  if (last && !last.ok) return { ok: false, count: enriched, ms, age_s, error: last.error ?? 'error' };
  if (enriched === 0) return { ok: false, count: 0, ms, age_s, error: job.queue.length > 0 ? 'queued' : 'empty' };
  return { ok: true, count: enriched, ms, age_s };
}

/** The same, as a snapshot ProviderRun (for /api/health between refreshes). */
export function nvdStatus(enriched: number, now = Date.now()): ProviderRun {
  // feeds.ts restates age_s from okAt when the snapshot is served.
  return { status: nvdProviderStatus(enriched, now), okAt: job.last?.at ?? null };
}

export function nvdProgress(awaitingAnalysis: number): NvdProgress {
  const rate = nvdBucket(job.keyed).ratePerSec;
  const queued = job.queue.length;
  return {
    queued,
    etaS: queued > 0 ? Math.ceil(queued / rate) : null,
    ratePer30s: Math.round(rate * 30 * 100) / 100,
    lastLookupAt: job.last?.at ? new Date(job.last.at).toISOString() : null,
    awaitingAnalysis,
  };
}

function merge(k: KevEntry): KevEntry {
  const c = scores.get(k.cveId);
  if (!c) return k;
  return { ...k, cvssScore: c.score?.score ?? null, cvssSeverity: c.score?.severity ?? null, cvssVersion: c.score?.version ?? null };
}

export interface KevData {
  items: KevEntry[];
  catalogVersion: string | null;
  enriched: number;
}

/**
 * Merge the NVD scores known now into a KEV snapshot and restate providers.nvd at response time.
 * `limit` merges only the newest N (the rest are not served).
 */
export function enrichKev(r: FeedResult<KevData>, limit?: number, now = Date.now()): { result: FeedResult<KevData>; nvd: NvdProgress } {
  if (r.data === null) return { result: r, nvd: nvdProgress(0) };
  let enriched = 0;
  let awaiting = 0;
  for (const k of r.data.items) {
    const c = scores.get(k.cveId);
    if (!c) continue;
    enriched++;
    if (c.score === null) awaiting++;
  }
  const items = (limit === undefined ? r.data.items : r.data.items.slice(0, limit)).map(merge);
  return {
    result: { ...r, data: { ...r.data, items, enriched }, providers: { ...r.providers, nvd: nvdProviderStatus(enriched, now) } },
    nvd: nvdProgress(awaiting),
  };
}

export const kevFeed = defineFeed<KevData>({
  key: 'cyber-threats',
  ttlMs: 60 * 60_000,
  pollMs: 10 * 60_000,
  kind: 'live',
  attribution: [
    { text: 'CISA Known Exploited Vulnerabilities Catalog', url: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog', licence: 'Public domain (US Government)' },
    { text: 'CVSS scores: NIST National Vulnerability Database', url: 'https://nvd.nist.gov/', licence: 'Public domain; not endorsed by NVD' },
  ],
  note: 'CVSS scores are looked up from NVD in the background at its rate limit (5 / 30 s keyless); every response carries the scores known so far and how many lookups are queued.',
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
    const now = Date.now();
    queueNvd(
      items
        .filter((k) => needsNvd(k.cveId, now))
        .slice(0, keyed ? NVD_PER_REFRESH.keyed : NVD_PER_REFRESH.keyless)
        .map((k) => k.cveId),
      keyed,
    );
    const out = items.map(merge);
    const enriched = out.filter((k) => k.cvssScore !== undefined).length;
    return { data: { items: out, catalogVersion: version, enriched }, providers: { cisa_kev: kev.run, nvd: nvdStatus(enriched) }, observedAt: released };
  },
});
