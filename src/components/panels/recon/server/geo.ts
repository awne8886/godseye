/**
 * Geocoding lookups behind /api/geo, /api/geo/reverse and /api/geosearch. All geocoder calls go
 * through src/lib/geocode.ts (Photon for type-ahead and reverse; Nominatim only through the one
 * 1 req/s queue, only on explicit submits or as the reverse fallback).
 * Owner: panels-recon. Server-only.
 */
import 'server-only';
import { OSM_ATTRIBUTION, nominatimReverse, nominatimSearch, parseLatLng, photonReverse, photonSearch } from '@/lib/geocode';
import { HttpError, httpJson } from '@/lib/http';
import { providerBucket } from '@/lib/ratelimit';
import type { Place, Providers } from '@/lib/types';
import { type Probe, type ProbeOptions, probe, skipped } from './lookup';

export const GEO_ATTRIBUTION = `Geocoding: Photon by komoot · Nominatim · ${OSM_ATTRIBUTION}`;

// ── Reverse geocoding on a 0.1° grid ─────────────────────────────────────────────
/** Snap to the centre of the 0.1° cell (≈ 11 km) the cursor is in: the cache key and the query point. */
export function gridCell(lat: number, lng: number): { lat: number; lng: number; key: string } {
  const g = (v: number) => Math.round(v * 10) / 10;
  let la = g(lat);
  let lo = g(lng);
  la = Math.max(-90, Math.min(90, la));
  lo = lo > 180 ? lo - 360 : lo < -180 ? lo + 360 : lo;
  return { lat: la, lng: lo, key: `${la.toFixed(1)},${lo.toFixed(1)}` };
}

const REVERSE_TTL_MS = 30 * 24 * 3600_000;

export interface GeoLookup {
  results: Place[];
  providers: Providers;
}

/**
 * Photon first; Nominatim (queued, 30-day cache in geocode.ts) only when Photon fails. The answer is for the grid cell centre, cached 30 days per cell.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<GeoLookup & { cell: string }> {
  const cell = gridCell(lat, lng);
  const providers: Providers = {};
  // "Nothing here" (open ocean) is a truthful answer; only a failed Photon falls through to Nominatim.
  const photon = await probe(`reverse:photon:${cell.key}`, REVERSE_TTL_MS, () => photonReverse(cell.lat, cell.lng), {
    count: (p) => (p ? 1 : 0),
    allowEmpty: true,
  });
  providers.photon = photon.status;
  if (photon.status.ok) return { results: photon.value ? [photon.value] : [], providers, cell: cell.key };
  const nom = await probe(`reverse:nominatim:${cell.key}`, REVERSE_TTL_MS, () => nominatimReverse(cell.lat, cell.lng, 10), {
    count: (p) => (p ? 1 : 0),
    allowEmpty: true,
  });
  providers.nominatim = nom.status;
  return { results: nom.value ? [nom.value] : [], providers, cell: cell.key };
}

// ── Forward search ──────────────────────────────────────────────────────────────
export interface SearchOptions {
  submit: boolean;
  lat?: number;
  lng?: number;
}

/**
 * `lat,lng` → instant coordinates result (no network). Otherwise Photon (type-ahead, cached 10 min
 * in geocode.ts). Nominatim runs only on an explicit submit, and only when Photon has no answer.
 */
export async function searchPlaces(q: string, opts: SearchOptions): Promise<GeoLookup> {
  const coords = parseLatLng(q);
  if (coords) return { results: [coords], providers: { coordinates: { ok: true, count: 1, ms: 0, age_s: 0 } } };
  const providers: Providers = {};
  const photon = await probe(`search:photon:${q.toLowerCase()}:${opts.lat?.toFixed(1)},${opts.lng?.toFixed(1)}`, 10 * 60_000, () => photonSearch(q, { lat: opts.lat, lng: opts.lng, limit: 8 }), {
    count: (r) => r.length,
    allowEmpty: true,
  });
  providers.photon = photon.status;
  const results = photon.value ?? [];
  if (opts.submit && results.length === 0) {
    const nom = await probe(`search:nominatim:${q.toLowerCase()}`, 30 * 24 * 3600_000, () => nominatimSearch(q, 5), { count: (r) => r.length, allowEmpty: true });
    providers.nominatim = nom.status;
    return { results: nom.value ?? [], providers };
  }
  return { results, providers };
}

// ── Visitor region (consented) ──────────────────────────────────────────────────
interface IpwhoBody {
  success?: boolean;
  message?: string;
  country?: string;
  country_code?: string;
  region?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
}
interface FreeIpApiBody {
  countryName?: string;
  countryCode?: string;
  regionName?: string;
  cityName?: string;
  latitude?: number;
  longitude?: number;
}

export const ipwhoBucket = () => providerBucket('ipwho.is', 1, 2);

/** ipwho.is free endpoint: 1,000 requests a day (ipwhois.io/pricing, 2026-10-02), counted per UTC day in this process. */
export const IPWHO_DAILY_LIMIT = 1000;
let ipwhoDay = { day: '', used: 0 };

/** Takes one request from today's ipwho.is budget; false once it is spent. */
export function takeIpwhoQuota(now = Date.now()): boolean {
  const day = new Date(now).toISOString().slice(0, 10);
  if (ipwhoDay.day !== day) ipwhoDay = { day, used: 0 };
  if (ipwhoDay.used >= IPWHO_DAILY_LIMIT) return false;
  ipwhoDay.used += 1;
  return true;
}

/** Test hook. */
export function resetIpwhoQuota(): void {
  ipwhoDay = { day: '', used: 0 };
}

/**
 * probe() for ipwho.is under the daily budget: a cached answer costs nothing; a real request takes
 * one unit, and once the day's budget is spent the provider reports skipped 'budget' (callers then
 * fall back to FreeIPAPI) instead of sending requests ipwho.is would refuse.
 */
export async function ipwhoProbe<T>(key: string, ttlMs: number, fn: () => Promise<T>, opts?: ProbeOptions<T>): Promise<Probe<T>> {
  let spent = false;
  const r = await probe(
    key,
    ttlMs,
    async () => {
      if (!takeIpwhoQuota()) {
        spent = true;
        throw new Error('ipwho.is daily budget spent');
      }
      return fn();
    },
    opts,
  );
  return spent ? { value: null, status: skipped('budget'), fetchedAt: null } : r;
}
const freeipapiBucket = () => providerBucket('free.freeipapi.com', 1, 1);

/** Region-level only: coordinates rounded to 0.1° so the answer is a region, never a street. */
function regionPlace(city: string | undefined, region: string | undefined, country: string | undefined, cc: string | undefined, lat: number | undefined, lng: number | undefined): Place | null {
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const name = city || region || country;
  if (!name) return null;
  return {
    name,
    label: [region && region !== name ? region : null, country].filter(Boolean).join(', ') || name,
    lat: Math.round(lat * 10) / 10,
    lng: Math.round(lng * 10) / 10,
    kind: 'ip-region',
    countryCode: cc?.toUpperCase() ?? null,
    bbox: null,
    source: 'ip',
  };
}

export async function ipwhoRegion(ip: string): Promise<Place | null> {
  const { data } = await httpJson<IpwhoBody>(`https://ipwho.is/${encodeURIComponent(ip)}`, { timeoutMs: 6000, retries: 0, limiter: ipwhoBucket() });
  if (!data || data.success === false) throw new HttpError(data?.message ?? 'ipwho.is refused the lookup', 'http', 'https://ipwho.is/');
  return regionPlace(data.city, data.region, data.country, data.country_code, data.latitude, data.longitude);
}

export async function freeipapiRegion(ip: string): Promise<Place | null> {
  // The v0 path answers 307 to /api/v1/json/{ip} (probe 2026-09-30).
  const { data } = await httpJson<FreeIpApiBody>(`https://free.freeipapi.com/api/v1/json/${encodeURIComponent(ip)}`, { timeoutMs: 6000, retries: 0, limiter: freeipapiBucket() });
  return data ? regionPlace(data.cityName, data.regionName, data.countryName, data.countryCode, data.latitude, data.longitude) : null;
}

/** Visitor region for "centre on my region": ipwho.is, then freeipapi. Not cached (per visitor). */
export async function visitorRegion(ip: string): Promise<GeoLookup> {
  const providers: Providers = {};
  const a = await ipwhoProbe(`ip-region:${ip}`, 0, () => ipwhoRegion(ip), { count: (p) => (p ? 1 : 0), noCache: true });
  providers['ipwho.is'] = a.status;
  if (a.value) return { results: [a.value], providers };
  const b = await probe(`ip-region2:${ip}`, 0, () => freeipapiRegion(ip), { count: (p) => (p ? 1 : 0), noCache: true });
  providers.freeipapi = b.status;
  return { results: b.value ? [b.value] : [], providers };
}

export { skipped };
