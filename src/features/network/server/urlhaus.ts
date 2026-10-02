/**
 * URLhaus malware hosts (INDICATORS) + SSE arrival beacons. Owner: layers-threats-network.
 * Server-only.
 *
 * Probed 2026-09-30: `downloads/csv_recent/` 200 in 0.35 s (2.9 MB, no CORS, Last-Modified +
 * ETag); a repeat with If-Modified-Since answered 304 in 0.27 s, so refreshes are conditional.
 * Columns: id, dateadded, url, url_status, last_online, threat, tags, urlhaus_link, reporter
 * (dates zone-less UTC). The keyless bulk file needs no Auth-Key (the API does since 2025-06-30).
 *
 * Only URLs whose host is a literal IPv4 are mapped (domains are never DNS-resolved: that tips
 * operators). Hosts are keyed by IP and geolocated through ipgeo.ts (precision labelled).
 * The SSE hub broadcasts `detections` only for IPs that were not in the previous snapshot and
 * `status` with the IPs that dropped out. A run that failed (CSV error, no rows, nothing
 * geolocated) is not a diff (round 10 BLOCKING 2): it retires nothing (the cache keeps the
 * last-good set) and broadcasts a degraded `status` ({state, lastGoodAt, error}) instead, so
 * clients keep their hosts badged STALE; the next good run (or 304) broadcasts `status` with
 * the served total and the state its observations support, which restores degraded clients.
 */
import 'server-only';
import { hasCapability } from '@/lib/capabilities';
import { csvRows } from '@/lib/csv';
import { defineFeed, runProvider, skippedProvider, type ProviderRun } from '@/lib/feeds';
import { normalizeUtc } from '@/lib/freshness';
import { httpText } from '@/lib/http';
import { providerBucket } from '@/lib/ratelimit';
import { getHub } from '@/lib/sse';
import type { MalwareHost } from '@/lib/types';
import type { MalwareStatus } from '../client/malware-state';
import { geolocate, isLookupableIp, type IpGeo } from './ipgeo';

export const URLHAUS_CSV = 'https://urlhaus.abuse.ch/downloads/csv_recent/';

export interface UrlhausRow {
  id: string;
  dateAdded: string | null;
  url: string;
  online: boolean;
  lastOnline: string | null;
  threat: string;
  tags: string[];
  link: string | null;
}

export function parseUrlhausCsv(text: string): UrlhausRow[] {
  const out: UrlhausRow[] = [];
  // Comment lines start with '#'; strip them before the RFC 4180 parser sees them.
  const body = text
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .join('\n');
  for (const r of csvRows(body)) {
    if (r.length < 8 || !/^\d+$/.test(r[0] ?? '')) continue;
    out.push({
      id: r[0]!,
      dateAdded: normalizeUtc(r[1]),
      url: r[2] ?? '',
      online: r[3] === 'online',
      lastOnline: normalizeUtc(r[4]),
      threat: r[5] || 'unknown',
      tags: (r[6] ?? '').split(',').map((t) => t.trim()).filter(Boolean),
      link: /^https:\/\/urlhaus\.abuse\.ch\//.test(r[7] ?? '') ? r[7]! : null,
    });
  }
  return out;
}

/** Host part of a URL if (and only if) it is a literal public IPv4, with the port. */
export function ipHostOf(url: string): { ip: string; port: number | null } | null {
  try {
    const u = new URL(url);
    if (!isLookupableIp(u.hostname)) return null;
    return { ip: u.hostname, port: u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80 };
  } catch {
    return null;
  }
}

const GENERIC_TAGS = /^(32-bit|64-bit|arm|arm7|elf|exe|mips|mipsel|x86|x86-64|sh4|ppc|m68k|sparc|dll|zip|rar|script|sh|bash|powershell|opendir|ua-wget|geofenced|[0-9a-f]{6}|dropped-by-.*)$/i;

/** Aggregate URL rows into one record per IP host (geo filled in later). Pure. */
export function groupHosts(rows: readonly UrlhausRow[]) {
  const hosts = new Map<string, { ip: string; port: number | null; threat: string; family: string | null; urlCount: number; online: boolean; link: string | null; firstSeen: string | null; lastSeen: string | null }>();
  for (const r of rows) {
    const h = ipHostOf(r.url);
    if (!h) continue;
    let rec = hosts.get(h.ip);
    if (!rec) {
      rec = { ip: h.ip, port: h.port, threat: r.threat, family: null, urlCount: 0, online: false, link: r.link, firstSeen: r.dateAdded, lastSeen: r.dateAdded };
      hosts.set(h.ip, rec);
    }
    rec.urlCount++;
    rec.online ||= r.online;
    rec.family ??= r.tags.find((t) => !GENERIC_TAGS.test(t) && /[a-z]/i.test(t)) ?? null;
    if (r.dateAdded && (!rec.firstSeen || r.dateAdded < rec.firstSeen)) rec.firstSeen = r.dateAdded;
    if (r.dateAdded && (!rec.lastSeen || r.dateAdded > rec.lastSeen)) {
      rec.lastSeen = r.dateAdded;
      rec.link = r.link ?? rec.link;
      rec.port = h.port;
    }
  }
  return [...hosts.values()];
}

export function toMalwareHost(h: ReturnType<typeof groupHosts>[number], geo: IpGeo): MalwareHost {
  return {
    id: h.ip,
    ip: h.ip,
    lat: geo.lat,
    lng: geo.lng,
    observedAt: h.lastSeen,
    source: 'urlhaus',
    port: h.port,
    threat: h.threat,
    family: h.family,
    urlCount: Math.max(1, h.urlCount),
    online: h.online,
    asn: geo.asn,
    country: geo.country,
    city: geo.city,
    geoPrecision: geo.precision,
    urlhausReference: h.link,
    firstSeen: h.firstSeen,
  };
}

/** Beacon diff: hosts whose IP was not in the previous snapshot, and IPs that dropped out. Pure. */
export function diffHosts(prev: readonly MalwareHost[] | null, next: readonly MalwareHost[]): { added: MalwareHost[]; retired: string[] } {
  if (!prev) return { added: [], retired: [] };
  const before = new Set(prev.map((h) => h.ip));
  const after = new Set(next.map((h) => h.ip));
  return { added: next.filter((h) => !before.has(h.ip)), retired: [...before].filter((ip) => !after.has(ip)) };
}

export interface MalwareData {
  items: MalwareHost[];
  hostsTotal: number;
  pendingGeo: number;
}

export const MALWARE_ATTRIBUTION = [
  { text: 'Malware URLs: abuse.ch URLhaus', url: 'https://urlhaus.abuse.ch/', licence: 'CC0; non-commercial terms of use' },
  { text: 'IP geolocation: ip-api.com (non-commercial free tier)', url: 'https://ip-api.com/' },
];

export function malwareSnapshot() {
  const r = malwareFeed.peek();
  return r.data ? { items: r.data.items, meta: r.meta, providers: r.providers } : null;
}

export const malwareHub = () => getHub('malware', malwareSnapshot);

/** Whether the last run broadcast a degraded status (the next good run must announce recovery). */
const degraded = (globalThis as unknown as { __godseyeMalwareDegraded?: { on: boolean } }).__godseyeMalwareDegraded ??= { on: false };

/** Status after a good run: the served total and the state its observations support. */
function goodStatus(retired: string[], items: readonly MalwareHost[]): MalwareStatus {
  const now = Date.now();
  let newest = 0;
  for (const h of items) if (h.observedAt) newest = Math.max(newest, Date.parse(h.observedAt));
  const maxAge = malwareFeed.def.maxObservationAgeMs ?? Infinity;
  const at = new Date(now).toISOString();
  return { retired, total: items.length, state: newest > 0 && now - newest > maxAge ? 'stale' : 'live', fetchedAt: at, lastGoodAt: at, at };
}

/** Broadcast that this run failed: no retirements, the last-good set and its time stand. */
function broadcastDegraded(error: string): void {
  const last = malwareFeed.peek();
  const lastGoodAt = last.data ? last.meta.lastGoodAt : null;
  const status: MalwareStatus = { retired: [], state: lastGoodAt ? 'stale' : 'offline', lastGoodAt, error, at: new Date().toISOString() };
  degraded.on = true;
  malwareHub().broadcast('status', status);
}

export const malwareFeed = defineFeed<MalwareData>({
  key: 'malware',
  ttlMs: 5 * 60_000,
  pollMs: 60_000,
  kind: 'live',
  attribution: MALWARE_ATTRIBUTION,
  note: 'INDICATORS from a blocklist: an IP that hosted malware URLs, not an attacker location. IP positions are approximate (precision shown).',
  count: (d) => d.items.length,
  deadlineMs: 90_000,
  maxObservationAgeMs: 6 * 60 * 60_000,
  run: async ({ signal, previous, etag, lastModified }) => {
    if (!hasCapability('nc_sources')) return { data: { items: [], hostsTotal: 0, pendingGeo: 0 }, providers: { urlhaus: skippedProvider('licence') } };
    const providers: Record<string, ProviderRun> = {};
    let notModified = false;
    const csv = await runProvider(
      async () => {
        const res = await httpText(URLHAUS_CSV, {
          signal,
          timeoutMs: 30_000,
          etag: previous ? etag : null,
          lastModified: previous ? lastModified : null,
          limiter: providerBucket('urlhaus', 1 / 60, 2),
        });
        if (res.notModified) {
          notModified = true;
          return { rows: [] as UrlhausRow[], etag: res.etag, lastModified: res.lastModified };
        }
        return { rows: parseUrlhausCsv(res.text ?? ''), etag: res.etag, lastModified: res.lastModified };
      },
      (r) => r.rows.length,
      { allowEmpty: true },
    );
    if (notModified && previous) {
      if (degraded.on) {
        degraded.on = false;
        malwareHub().broadcast('status', goodStatus([], previous.items));
      }
      return { notModified: true };
    }
    providers.urlhaus = csv.run;
    const hosts = groupHosts(csv.result?.rows ?? []);
    // Online and newest hosts are geolocated first (the ip-api budget is 15 batches/minute).
    hosts.sort((a, b) => Number(b.online) - Number(a.online) || (b.lastSeen ?? '').localeCompare(a.lastSeen ?? ''));
    let located = new Map<string, IpGeo>();
    let pending = 0;
    let geoOk = false;
    if (hosts.length) {
      const geo = await runProvider(
        () => geolocate(hosts.map((h) => h.ip), { signal, maxBatches: 6 }),
        (r) => r.located.size,
      );
      providers['ip-api'] = geo.run;
      located = geo.result?.located ?? new Map();
      pending = geo.result?.deferred ?? hosts.length;
      geoOk = geo.run.status.ok;
    }
    const items = hosts.flatMap((h) => {
      const g = located.get(h.ip);
      return g ? [toMalwareHost(h, g)] : [];
    });
    const csvOk = csv.run.status.ok && (csv.result?.rows.length ?? 0) > 0;
    if (!csvOk) providers.urlhaus = { ...csv.run, status: { ...csv.run.status, ok: false, error: csv.run.status.error ?? 'empty' } };
    if (!csvOk || !geoOk || items.length === 0) {
      // A failed run is not "every host retired": the cache keeps the last-good set (this answer
      // counts as empty), and clients are told it is stale instead of being emptied.
      broadcastDegraded(!csvOk ? 'urlhaus_unavailable' : 'geolocation_unavailable');
    } else {
      // Arrival beacons: NEW IPs only (never re-announce hosts the clients already have).
      const { added, retired } = diffHosts(previous?.items ?? null, items);
      const hub = malwareHub();
      // Every added host is sent (in chunks of 200 per event), then the server's own total, so a
      // client's set — and the count derived from it — always equals what is served.
      for (let i = 0; i < added.length; i += 200) hub.broadcast('detections', added.slice(i, i + 200));
      if (added.length || retired.length || degraded.on) hub.broadcast('status', goodStatus(retired, items));
      degraded.on = false;
    }
    let newest = 0;
    for (const h of items) if (h.observedAt) newest = Math.max(newest, Date.parse(h.observedAt));
    return {
      data: { items, hostsTotal: hosts.length, pendingGeo: pending },
      providers,
      observedAt: newest || null,
      etag: csv.result?.etag ?? null,
      lastModified: csv.result?.lastModified ?? null,
    };
  },
});
