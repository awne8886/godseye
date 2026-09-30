/**
 * CISA Known Exploited Vulnerabilities + NVD CVSS enrichment (/api/cyber-threats). Owner:
 * layers-threats-network. Server-only.
 *
 * Probed 2026-09-30: KEV JSON 200 in 0.46 s (1.7 MB, 1 730 entries, catalogVersion 2026.09.30,
 * ETag + Last-Modified, no CORS). NVD 2.0 `cves/2.0?cveId=` 200 in 0.43 s (ACAO *); keyless limit
 * 5 requests / 30 s (the bucket below; NVD_API_KEY raises it to 50 / 30 s and goes in the `apiKey`
 * header, never the URL). Each refresh enriches the newest not-yet-scored CVEs within that budget.
 */
import 'server-only';
import { hasCapability } from '@/lib/capabilities';
import { defineFeed, runProvider } from '@/lib/feeds';
import { httpJson } from '@/lib/http';
import { providerBucket } from '@/lib/ratelimit';
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

const G = globalThis as unknown as { __godseyeNvd?: Map<string, { score: number; severity: string | null; version: string } | null> };
const scores = (G.__godseyeNvd ??= new Map());

export const kevFeed = defineFeed<{ items: KevEntry[]; catalogVersion: string | null; enriched: number }>({
  key: 'cyber-threats',
  ttlMs: 60 * 60_000,
  pollMs: 10 * 60_000,
  kind: 'live',
  attribution: [
    { text: 'CISA Known Exploited Vulnerabilities Catalog', url: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog', licence: 'Public domain (US Government)' },
    { text: 'CVSS scores: NIST National Vulnerability Database', url: 'https://nvd.nist.gov/', licence: 'Public domain; not endorsed by NVD' },
  ],
  count: (d) => d.items.length,
  deadlineMs: 90_000,
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
    const bucket = keyed ? providerBucket('nvd-keyed', 50 / 30) : providerBucket('nvd', 5 / 30);
    const todo = items.filter((k) => !scores.has(k.cveId)).slice(0, keyed ? 40 : 5);
    const nvd = await runProvider(
      async () => {
        let n = 0;
        for (const k of todo) {
          const res = await httpJson<Parameters<typeof nvdScore>[0]>(`${NVD_URL}${k.cveId}`, {
            signal,
            timeoutMs: 15_000,
            retries: 0,
            limiter: bucket,
            headers: keyed ? { apiKey: process.env.NVD_API_KEY ?? '' } : {},
          });
          scores.set(k.cveId, nvdScore(res.data ?? {}));
          n++;
        }
        return n;
      },
      (n) => n,
      { allowEmpty: true },
    );
    let enriched = 0;
    const out = items.map((k) => {
      const s = scores.get(k.cveId);
      if (s === undefined) return k;
      enriched++;
      return { ...k, cvssScore: s?.score ?? null, cvssSeverity: s?.severity ?? null, cvssVersion: s?.version ?? null };
    });
    return { data: { items: out, catalogVersion: version, enriched }, providers: { cisa_kev: kev.run, nvd: nvd.run }, observedAt: released };
  },
});
