/**
 * abuse.ch blocklists drawn as INDICATOR points: Feodo Tracker botnet C2s (/api/cyber-attacks) and
 * ThreatFox recent IOCs (/api/threatfox). Owner: layers-threats-network. Server-only.
 *
 * Probed 2026-09-30 (keyless bulk files, no CORS):
 *  - Feodo `downloads/ipblocklist.json` 200 in 0.42 s, 1.7 KB, Last-Modified 2026-06-30 (the list
 *    has not changed for three months: the feed's observation age caps it at STALE, and when one C2
 *    is online we say exactly that — "honest single live C2").
 *  - ThreatFox `export/json/recent/` 200 in 0.40 s, 4.3 MB: {id: [ioc]} with ioc_type ip:port 3 695,
 *    domain 2 269, url 370, hashes 527; threat_type botnet_cc 4 868. Dates zone-less UTC.
 * Never drawn as arcs: a blocklist names one end only. Domains/URLs/hashes are never resolved;
 * only literal IP IOCs are geolocated (ipgeo.ts) and the rest stay in the list with `geo: null`.
 */
import 'server-only';
import { hasCapability } from '@/lib/capabilities';
import { defineFeed, runProvider, skippedProvider, type ProviderRun } from '@/lib/feeds';
import { normalizeUtc } from '@/lib/freshness';
import { httpJson } from '@/lib/http';
import { providerBucket } from '@/lib/ratelimit';
import type { C2Server, ThreatIndicator } from '@/lib/types';
import { countryByIso2 } from '../../threats/shared/country';
import { geolocate, isLookupableIp, type IpGeo } from './ipgeo';

export const FEODO_URL = 'https://feodotracker.abuse.ch/downloads/ipblocklist.json';
export const THREATFOX_URL = 'https://threatfox.abuse.ch/export/json/recent/';

export const ABUSECH_ATTRIBUTION = { text: 'abuse.ch (Feodo Tracker, ThreatFox)', url: 'https://abuse.ch/', licence: 'CC0; non-commercial terms of use' };
const IPAPI_ATTRIBUTION = { text: 'IP geolocation: ip-api.com (non-commercial free tier)', url: 'https://ip-api.com/' };

export interface FeodoRow {
  ip_address: string;
  port?: number | null;
  status?: string;
  hostname?: string | null;
  as_number?: number | null;
  as_name?: string | null;
  country?: string | null;
  first_seen?: string | null;
  last_online?: string | null;
  malware?: string | null;
}

/** Feodo rows → C2 indicators (geo: ip-api when available, else the country's label point). Pure. */
export function toC2(rows: readonly FeodoRow[], geo: ReadonlyMap<string, IpGeo>): { items: C2Server[]; unlocated: number } {
  const items: C2Server[] = [];
  let unlocated = 0;
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r.ip_address || seen.has(r.ip_address)) continue;
    seen.add(r.ip_address);
    const g = geo.get(r.ip_address);
    const c = g ? null : countryByIso2(r.country);
    if (!g && !c) {
      unlocated++;
      continue;
    }
    const lastOnline = normalizeUtc(r.last_online);
    items.push({
      id: r.ip_address,
      ip: r.ip_address,
      lat: g?.lat ?? c!.lat,
      lng: g?.lng ?? c!.lng,
      observedAt: lastOnline,
      source: 'feodo',
      port: typeof r.port === 'number' ? r.port : null,
      malware: r.malware ?? null,
      status: r.status === 'online' ? 'online' : 'offline',
      asn: typeof r.as_number === 'number' ? `AS${r.as_number}` : null,
      asName: r.as_name ?? null,
      country: g?.country ?? c?.name ?? r.country ?? null,
      hostname: r.hostname ?? null,
      firstSeen: normalizeUtc(r.first_seen),
      lastOnline,
      lastOnlineDateOnly: !!r.last_online && /^\d{4}-\d{2}-\d{2}$/.test(r.last_online.trim()),
      geoPrecision: g?.precision ?? 'country-centroid',
      label: 'INDICATOR',
    });
  }
  return { items, unlocated };
}

export interface C2Data {
  items: C2Server[];
  onlineCount: number;
  unlocated: number;
}

export const c2Feed = defineFeed<C2Data>({
  gates: ['nc_sources'],
  key: 'cyber-attacks',
  ttlMs: 5 * 60_000,
  kind: 'live',
  attribution: [ABUSECH_ATTRIBUTION, IPAPI_ATTRIBUTION],
  note: 'Botnet C2 INDICATORS from Feodo Tracker (blocklist entries, not observed attacks). Status is Feodo’s own check; last-online is a date only.',
  count: (d) => d.items.length,
  // Feodo stopped updating in June 2026: a list whose newest last-online is weeks old is STALE, not LIVE.
  maxObservationAgeMs: 3 * 24 * 60 * 60_000,
  deadlineMs: 45_000,
  run: async ({ signal }) => {
    if (!hasCapability('nc_sources')) return { data: { items: [], onlineCount: 0, unlocated: 0 }, providers: { feodo: skippedProvider('licence') } };
    const providers: Record<string, ProviderRun> = {};
    const feodo = await runProvider(
      async () => (await httpJson<FeodoRow[]>(FEODO_URL, { signal, timeoutMs: 20_000, limiter: providerBucket('feodo', 1 / 60, 2) })).data ?? [],
      (r) => r.length,
    );
    providers.feodo = feodo.run;
    const rows = feodo.result ?? [];
    let geo = new Map<string, IpGeo>();
    if (rows.length) {
      const g = await runProvider(() => geolocate(rows.map((r) => r.ip_address), { signal, maxBatches: 1 }), (r) => r.located.size, { allowEmpty: true });
      providers['ip-api'] = g.run;
      geo = g.result?.located ?? geo;
    }
    const { items, unlocated } = toC2(rows, geo);
    let newest = 0;
    for (const i of items) if (i.lastOnline) newest = Math.max(newest, Date.parse(i.lastOnline));
    return { data: { items, onlineCount: items.filter((i) => i.status === 'online').length, unlocated }, providers, observedAt: newest || null };
  },
});

// ── ThreatFox ───────────────────────────────────────────────────────────────────
export interface ThreatFoxIoc {
  ioc_value: string;
  ioc_type: string;
  threat_type: string;
  malware_printable?: string | null;
  confidence_level?: number | null;
  first_seen_utc?: string | null;
  last_seen_utc?: string | null;
  reference?: string | null;
  tags?: string | null;
}

const MAX_IOCS = 2_000;

/** Flatten the export ({id: [ioc]}) newest first, capped. Pure. */
export function flattenThreatFox(exp: Record<string, ThreatFoxIoc[]>): (ThreatFoxIoc & { id: string })[] {
  const all: (ThreatFoxIoc & { id: string })[] = [];
  for (const [id, list] of Object.entries(exp)) for (const ioc of list ?? []) if (/^\d+$/.test(id) && ioc?.ioc_value) all.push({ ...ioc, id });
  all.sort((a, b) => Number(b.id) - Number(a.id));
  return all.slice(0, MAX_IOCS);
}

/** `1.2.3.4:443` → `1.2.3.4` for ip:port IOCs; null otherwise (domains are never resolved). */
export function iocIp(ioc: { ioc_type: string; ioc_value: string }): string | null {
  if (ioc.ioc_type !== 'ip:port') return null;
  const ip = ioc.ioc_value.split(':')[0] ?? '';
  return isLookupableIp(ip) ? ip : null;
}

const httpUrl = (u: unknown) => (typeof u === 'string' && /^https?:\/\/[^\s]+$/i.test(u) ? u : null);

export function toIndicator(i: ThreatFoxIoc & { id: string }, geo: IpGeo | undefined): ThreatIndicator {
  const firstSeen = normalizeUtc(i.first_seen_utc);
  const conf = typeof i.confidence_level === 'number' ? Math.max(0, Math.min(100, Math.round(i.confidence_level))) : null;
  return {
    id: `tf-${i.id}`,
    threatfoxId: i.id,
    ioc: i.ioc_value.slice(0, 512),
    iocType: i.ioc_type,
    threatType: i.threat_type,
    malware: i.malware_printable ?? null,
    confidence: conf,
    tags: (i.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 12),
    firstSeen,
    observedAt: normalizeUtc(i.last_seen_utc) ?? firstSeen,
    reference: httpUrl(i.reference) ?? `https://threatfox.abuse.ch/ioc/${i.id}/`,
    source: 'threatfox',
    geo: geo ? { lat: geo.lat, lng: geo.lng, precision: geo.precision, country: geo.country } : null,
    label: 'INDICATOR',
  };
}

export const threatFoxFeed = defineFeed<{ items: ThreatIndicator[]; located: number }>({
  gates: ['nc_sources'],
  key: 'threatfox',
  ttlMs: 10 * 60_000,
  kind: 'live',
  attribution: [ABUSECH_ATTRIBUTION, IPAPI_ATTRIBUTION],
  note: 'IOCs are INDICATORS reported to ThreatFox (last 48 h). Only IP IOCs are placed on the map; domains, URLs and hashes are listed, never resolved.',
  count: (d) => d.items.length,
  maxObservationAgeMs: 12 * 60 * 60_000,
  deadlineMs: 90_000,
  run: async ({ signal }) => {
    if (!hasCapability('nc_sources')) return { data: { items: [], located: 0 }, providers: { threatfox: skippedProvider('licence') } };
    const providers: Record<string, ProviderRun> = {};
    const tf = await runProvider(
      async () => flattenThreatFox((await httpJson<Record<string, ThreatFoxIoc[]>>(THREATFOX_URL, { signal, timeoutMs: 40_000, limiter: providerBucket('threatfox', 1 / 60, 2) })).data ?? {}),
      (r) => r.length,
    );
    providers.threatfox = tf.run;
    const iocs = tf.result ?? [];
    const ips = iocs.map(iocIp).filter((x): x is string => x !== null);
    let geo = new Map<string, IpGeo>();
    if (ips.length) {
      const g = await runProvider(() => geolocate(ips, { signal, maxBatches: 4 }), (r) => r.located.size, { allowEmpty: true });
      providers['ip-api'] = g.run;
      geo = g.result?.located ?? geo;
    }
    const items = iocs.map((i) => toIndicator(i, geo.get(iocIp(i) ?? '')));
    let newest = 0;
    for (const i of items) if (i.observedAt) newest = Math.max(newest, Date.parse(i.observedAt));
    return { data: { items, located: items.filter((i) => i.geo).length }, providers, observedAt: newest || null };
  },
});
