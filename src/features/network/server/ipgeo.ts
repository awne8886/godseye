/**
 * IP geolocation for blocklist indicators via ip-api.com's batch endpoint. Owner:
 * layers-threats-network. Server-only.
 *
 * Probed 2026-09-30: POST http://ip-api.com/batch 200 in 0.12 s (ACAO *). The free tier is HTTP
 * only, non-commercial (gated by `nc_sources`), 15 batch requests/minute of ≤ 100 IPs each; the
 * bucket below enforces that per process. Results are cached per IP for 24 h. Only literal IP
 * addresses are ever looked up: attacker domains are never DNS-resolved (that tips operators).
 * An IP location is approximate by nature, so each result carries its precision.
 */
import 'server-only';
import { isIP } from 'node:net';
import { httpJson } from '@/lib/http';
import { providerBucket } from '@/lib/ratelimit';
import type { GeoPrecision } from '@/lib/types';

export const IPAPI_BATCH = 'http://ip-api.com/batch?fields=status,message,country,countryCode,regionName,city,lat,lon,as,query';
const TTL_MS = 24 * 60 * 60_000;
const MAX_ENTRIES = 50_000;

export interface IpGeo {
  lat: number;
  lng: number;
  precision: GeoPrecision;
  country: string | null;
  countryCode: string | null;
  city: string | null;
  asn: string | null;
}

interface IpApiRow {
  status?: string;
  query?: string;
  country?: string;
  countryCode?: string;
  regionName?: string;
  city?: string;
  lat?: number;
  lon?: number;
  as?: string;
}

const G = globalThis as unknown as { __godseyeIpGeo?: Map<string, { at: number; geo: IpGeo | null }> };
const cache = (G.__godseyeIpGeo ??= new Map());

export function toIpGeo(r: IpApiRow): IpGeo | null {
  if (r.status !== 'success' || typeof r.lat !== 'number' || typeof r.lon !== 'number') return null;
  if (Math.abs(r.lat) > 90 || Math.abs(r.lon) > 180 || (r.lat === 0 && r.lon === 0)) return null;
  const precision: GeoPrecision = r.city ? 'city' : r.regionName ? 'region' : 'country-centroid';
  return { lat: r.lat, lng: r.lon, precision, country: r.country ?? null, countryCode: r.countryCode ?? null, city: r.city || null, asn: r.as ? (r.as.split(' ')[0] ?? null) : null };
}

/** Only public literal IPs are ever looked up. */
export function isLookupableIp(ip: string): boolean {
  if (isIP(ip) !== 4) return false;
  const [a, b] = ip.split('.').map(Number) as [number, number];
  return !(a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a >= 224);
}

export function cachedGeo(ip: string, now = Date.now()): IpGeo | null | undefined {
  const hit = cache.get(ip);
  if (!hit || now - hit.at > TTL_MS) return undefined;
  return hit.geo;
}

export interface GeoRun {
  located: Map<string, IpGeo>;
  /** IPs still unresolved because the per-run batch budget ran out. */
  deferred: number;
  requests: number;
}

/**
 * Resolve `ips` (cache first, then ≤ `maxBatches` batch POSTs of 100). Throws only when a request
 * fails and nothing could be served from cache.
 */
export async function geolocate(ips: readonly string[], { signal, maxBatches = 2 }: { signal?: AbortSignal; maxBatches?: number } = {}): Promise<GeoRun> {
  const located = new Map<string, IpGeo>();
  const missing: string[] = [];
  const now = Date.now();
  for (const ip of new Set(ips)) {
    if (!isLookupableIp(ip)) continue;
    const c = cachedGeo(ip, now);
    if (c === undefined) missing.push(ip);
    else if (c) located.set(ip, c);
  }
  let requests = 0;
  let failure: unknown = null;
  for (let i = 0; i < missing.length && requests < maxBatches; i += 100) {
    const chunk = missing.slice(i, i + 100);
    try {
      requests++;
      const res = await httpJson<IpApiRow[]>(IPAPI_BATCH, {
        method: 'POST',
        body: JSON.stringify(chunk),
        headers: { 'content-type': 'application/json' },
        signal,
        timeoutMs: 15_000,
        limiter: providerBucket('ip-api-batch', 15 / 60, 2),
      });
      const rows = res.data ?? [];
      for (const r of rows) {
        if (!r.query) continue;
        const geo = toIpGeo(r);
        if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
        cache.set(r.query, { at: Date.now(), geo });
        if (geo) located.set(r.query, geo);
      }
    } catch (e) {
      failure = e;
      break;
    }
  }
  if (failure && located.size === 0 && missing.length > 0) throw failure;
  const done = Math.min(missing.length, requests * 100);
  return { located, deferred: Math.max(0, missing.length - done), requests };
}

/** Test hook. */
export function resetIpGeo(): void {
  cache.clear();
}
