/**
 * OFAC SDN search over the OpenSanctions bulk export (us_ofac_sdn targets.simple.csv, ~7.5 MB,
 * refreshed daily; CC BY-NC 4.0 → behind `nc_sources`). The file is downloaded once per day by
 * this server; the query itself never leaves the server. Only screening fields are kept (name,
 * aliases, type, countries, programmes, identifiers, dates) — no addresses, birth dates, phones or
 * emails. Owner: panels-recon. Server-only.
 */
import 'server-only';
import { sourceCache } from '@/lib/cache';
import { parseCsv } from '@/lib/csv';
import { normalizeUtc } from '@/lib/freshness';
import { httpText } from '@/lib/http';
import type { ProviderStatus } from '@/lib/types';

export const OFAC_CSV_URL = 'https://data.opensanctions.org/datasets/latest/us_ofac_sdn/targets.simple.csv';
export const SANCTIONS_ATTRIBUTION = 'OpenSanctions (us_ofac_sdn), CC BY-NC 4.0 — https://www.opensanctions.org/datasets/us_ofac_sdn/';

export interface SdnEntry {
  id: string;
  schema: string;
  name: string;
  aliases: string[];
  countries: string[];
  sanctions: string[];
  identifiers: string[];
  firstSeen: string | null;
  lastChange: string | null;
}

const split = (v: string | undefined) => (v ? v.split(';').map((s) => s.trim()).filter(Boolean) : []);

export function parseSdn(csv: string): SdnEntry[] {
  return parseCsv(csv)
    .filter((r) => r.id && r.name)
    .map((r) => ({
      id: r.id!,
      schema: r.schema ?? 'Thing',
      name: r.name!,
      aliases: split(r.aliases).slice(0, 20),
      countries: split(r.countries).map((c) => c.toUpperCase()),
      sanctions: split(r.sanctions).slice(0, 5),
      identifiers: split(r.identifiers).slice(0, 20),
      firstSeen: normalizeUtc(r.first_seen ?? null),
      lastChange: normalizeUtc(r.last_change ?? null),
    }));
}

const fold = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Every query token must appear in the name or an alias (accent/case-insensitive). Exact names rank first. */
export function searchSdn(entries: readonly SdnEntry[], q: string, limit = 25): { entry: SdnEntry; matched: string; exact: boolean }[] {
  const tokens = fold(q).split(' ').filter(Boolean);
  if (!tokens.length) return [];
  const needle = tokens.join(' ');
  const out: { entry: SdnEntry; matched: string; exact: boolean }[] = [];
  for (const e of entries) {
    for (const n of [e.name, ...e.aliases]) {
      const hay = fold(n);
      if (tokens.every((t) => hay.includes(t))) {
        out.push({ entry: e, matched: n, exact: hay === needle });
        break;
      }
    }
  }
  return out.sort((a, b) => Number(b.exact) - Number(a.exact) || a.entry.name.length - b.entry.name.length).slice(0, limit);
}

/** Wallet addresses and other identifiers listed on the SDN (exact, case-insensitive for hex). */
export function identifierHits(entries: readonly SdnEntry[], id: string): SdnEntry[] {
  const needle = id.startsWith('0x') ? id.toLowerCase() : id;
  return entries.filter((e) => e.identifiers.some((x) => (x.startsWith('0x') ? x.toLowerCase() : x) === needle));
}

export const sdnCache = sourceCache<SdnEntry[]>(
  'recon:ofac-sdn',
  async (_prev, signal) => {
    const { text } = await httpText(OFAC_CSV_URL, { timeoutMs: 45_000, retries: 1, deadlineMs: 90_000, maxBytes: 40 * 1024 * 1024, maxRedirects: 3, signal });
    return { data: parseSdn(text ?? '') };
  },
  { ttlMs: 24 * 3600_000, deadlineMs: 90_000, retryAfterErrorMs: 10 * 60_000, pin: true },
);

export async function loadSdn(): Promise<{ entries: SdnEntry[] | null; status: ProviderStatus }> {
  const t0 = Date.now();
  const r = await sdnCache.get();
  const ok = r.data !== null && r.data.length > 0;
  return {
    entries: ok ? r.data : null,
    status: {
      ok,
      count: r.data?.length ?? 0,
      ms: Date.now() - t0,
      age_s: ok && r.fetchedAt ? Math.round((Date.now() - r.fetchedAt) / 1000) : null,
      ...(!ok ? { error: r.error ?? 'empty' } : {}),
    },
  };
}
