/**
 * Daily chain brief: DefiLlama hacks (exploits), NVD CVEs mentioning cryptocurrency, and OFAC-listed
 * wallets from OpenSanctions. Probed 2026-09-30: api.llama.fi/hacks 200 (1 290 records, unix `date`
 * seconds, `amount` USD, `chain[]`, `technique`); NVD 2.0 keywordSearch 200 (keyless 5 req/30 s,
 * pub-date windows ≤ 120 days — hence the 120-day cap); api.opensanctions.org answers 401 without a
 * key, so sanctioned wallets need `OPENSANCTIONS_KEY` (skipped as `not-configured` otherwise).
 * Owner: panels-alerts-markets-dossier-graph. Server-only.
 */
import 'server-only';
import { runProvider, skippedProvider, type FeedData, type ProviderRun } from '@/lib/feeds';
import { hasCapability } from '@/lib/capabilities';
import { getJson } from './get-json';
import { nvdBucket } from '@/lib/ratelimit';

export const CHAIN_WINDOW_DAYS = 120;

export interface Exploit {
  name: string;
  date: string;
  amountUsd: number | null;
  chain: string | null;
  technique: string | null;
  source: string;
}
export interface Cve {
  id: string;
  cvss: number | null;
  summary: string;
  published: string;
}
export interface SanctionedWallet {
  address: string;
  chain: string;
  entity: string;
}
export interface ChainData {
  exploits: Exploit[];
  cves: Cve[];
  sanctionedWallets: SanctionedWallet[];
  degraded: string[];
}

interface LlamaHack {
  date: number;
  name: string;
  technique?: string | null;
  amount?: number | null;
  chain?: string[] | null;
  classification?: string | null;
}

export function parseLlama(rows: LlamaHack[], now: number, days = CHAIN_WINDOW_DAYS): Exploit[] {
  const since = now - days * 86_400_000;
  return rows
    .filter((r) => typeof r.date === 'number' && r.date * 1000 >= since && r.date * 1000 <= now && r.name)
    .sort((a, b) => b.date - a.date)
    .map((r) => ({
      name: String(r.name).slice(0, 120),
      date: new Date(r.date * 1000).toISOString().slice(0, 10),
      amountUsd: typeof r.amount === 'number' && Number.isFinite(r.amount) ? r.amount : null,
      chain: r.chain?.[0] ?? null,
      technique: r.technique ?? r.classification ?? null,
      source: 'defillama',
    }));
}

interface NvdBody {
  vulnerabilities?: {
    cve: {
      id: string;
      published: string;
      descriptions?: { lang: string; value: string }[];
      metrics?: Record<string, { cvssData?: { baseScore?: number } }[] | undefined>;
    };
  }[];
}

/** NVD `published` is zone-less UTC ("2018-03-13T15:29:01.597"): append Z, never parse as local. */
export function parseNvd(body: NvdBody): Cve[] {
  return (body.vulnerabilities ?? []).map(({ cve }) => {
    const m = cve.metrics ?? {};
    const score = m.cvssMetricV40?.[0]?.cvssData?.baseScore ?? m.cvssMetricV31?.[0]?.cvssData?.baseScore ?? m.cvssMetricV30?.[0]?.cvssData?.baseScore ?? m.cvssMetricV2?.[0]?.cvssData?.baseScore ?? null;
    const pub = /[zZ]|[+-]\d\d:\d\d$/.test(cve.published) ? cve.published : `${cve.published}Z`;
    return {
      id: cve.id,
      cvss: typeof score === 'number' ? score : null,
      summary: (cve.descriptions?.find((d) => d.lang === 'en')?.value ?? '').slice(0, 400),
      published: new Date(Date.parse(pub)).toISOString(),
    };
  });
}

const nvdDate = (ms: number) => new Date(ms).toISOString().replace('Z', '+00:00');

interface OsWallet {
  caption?: string;
  properties?: { publicKey?: string[]; currency?: string[]; holder?: string[] };
}

export function parseOpenSanctionsWallets(body: { results?: OsWallet[] }): SanctionedWallet[] {
  return (body.results ?? []).flatMap((r) => {
    const address = r.properties?.publicKey?.[0];
    if (!address) return [];
    return [{ address, chain: r.properties?.currency?.[0] ?? 'unknown', entity: r.properties?.holder?.[0] ?? r.caption ?? 'unknown' }];
  });
}

export async function runChain(ctx: { signal?: AbortSignal } = {}, now = Date.now()): Promise<FeedData<ChainData>> {
  const providers: Record<string, ProviderRun> = {};
  const [llama, nvd] = await Promise.all([
    runProvider(async () => parseLlama((await getJson<LlamaHack[]>('https://api.llama.fi/hacks', { timeoutMs: 15_000, signal: ctx.signal })).data, now), (x) => x.length, { allowEmpty: true }),
    runProvider(
      async () => {
        const url = `https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=cryptocurrency&pubStartDate=${encodeURIComponent(nvdDate(now - (CHAIN_WINDOW_DAYS - 1) * 86_400_000))}&pubEndDate=${encodeURIComponent(nvdDate(now))}&resultsPerPage=100`;
        const headers: Record<string, string> = process.env.NVD_API_KEY ? { apiKey: process.env.NVD_API_KEY } : {};
        return parseNvd((await getJson<NvdBody>(url, { timeoutMs: 20_000, signal: ctx.signal, headers, limiter: nvdBucket() })).data);
      },
      (x) => x.length,
      { allowEmpty: true },
    ),
  ]);
  providers.defillama = llama.run;
  providers.nvd = nvd.run;
  let wallets: SanctionedWallet[] = [];
  if (!hasCapability('opensanctions')) providers.opensanctions = skippedProvider('not-configured');
  else {
    const os = await runProvider(
      async () =>
        parseOpenSanctionsWallets(
          (await getJson<{ results?: OsWallet[] }>('https://api.opensanctions.org/search/sanctions?schema=CryptoWallet&limit=100', { timeoutMs: 15_000, signal: ctx.signal, headers: { Authorization: `ApiKey ${process.env.OPENSANCTIONS_KEY ?? ''}` } })).data,
        ),
      (x) => x.length,
    );
    providers.opensanctions = os.run;
    wallets = os.result ?? [];
  }
  const degraded = Object.entries(providers)
    .filter(([, r]) => !r.status.ok)
    .map(([k]) => k);
  const newest = llama.result?.[0] ? Date.parse(`${llama.result[0].date}T00:00:00Z`) : null;
  return { data: { exploits: llama.result ?? [], cves: nvd.result ?? [], sanctionedWallets: wallets, degraded }, providers, observedAt: newest };
}
