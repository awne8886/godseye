/**
 * Geocoding (§6): Photon for type-ahead and reverse; Nominatim behind ONE server queue
 * (1 request/s, ≤ 40 queued, 30-day cache in the SnapshotStore, stats in /api/health).
 * Nominatim is never used for autocomplete and never called from the browser.
 * Base URLs: PHOTON_URL, NOMINATIM_URL (self-hosted instances welcome).
 * Owner: lead. Server-only.
 */
import { getStore } from './cache';
import { httpJson } from './http';
import { QueueFullError, SerialQueue } from './ratelimit';
import type { Place } from './types';

export const OSM_ATTRIBUTION = '© OpenStreetMap contributors (ODbL)';
const NOMINATIM_TTL_MS = 30 * 24 * 3600_000;
const PHOTON_TTL_MS = 10 * 60_000;

const G = globalThis as unknown as { __godseyeGeo?: { queue: SerialQueue; cached: number; mem: Map<string, { at: number; v: unknown }> } };
const state = (G.__godseyeGeo ??= { queue: new SerialQueue(1100, 40), cached: 0, mem: new Map() });

const photonBase = () => (process.env.PHOTON_URL || 'https://photon.komoot.io').replace(/\/$/, '');
const nominatimBase = () => (process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org').replace(/\/$/, '');

export function geocoderStats() {
  return { queueDepth: state.queue.queueDepth, maxQueue: state.queue.maxQueue, cached: state.cached, served: state.queue.served, rejected: state.queue.rejected };
}

function memGet<T>(key: string, ttl: number): T | undefined {
  const e = state.mem.get(key);
  if (!e) return undefined;
  if (Date.now() - e.at > ttl) {
    state.mem.delete(key);
    return undefined;
  }
  return e.v as T;
}
function memSet(key: string, v: unknown) {
  state.mem.set(key, { at: Date.now(), v });
  if (state.mem.size > 2000) state.mem.delete(state.mem.keys().next().value!);
}

/** `"51.5, -0.12"` → an instant coordinates result (no network). */
export function parseLatLng(q: string): Place | null {
  const m = q.trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { name: `${lat.toFixed(4)}, ${lng.toFixed(4)}`, label: 'Coordinates', lat, lng, kind: 'coordinates', countryCode: null, bbox: null, source: 'coordinates' };
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    city?: string;
    state?: string;
    country?: string;
    countrycode?: string;
    osm_key?: string;
    osm_value?: string;
    type?: string;
    extent?: [number, number, number, number];
  };
}

function fromPhoton(f: PhotonFeature): Place | null {
  const [lng, lat] = f.geometry?.coordinates ?? [];
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  const p = f.properties ?? {};
  const name = p.name ?? p.city ?? p.state ?? p.country;
  if (!name) return null;
  const label = [p.city && p.city !== name ? p.city : null, p.state, p.country].filter(Boolean).join(', ');
  const e = p.extent;
  return {
    name,
    label: label || name,
    lat,
    lng,
    kind: p.osm_value ?? p.type ?? 'place',
    countryCode: p.countrycode?.toUpperCase() ?? null,
    bbox: e ? [e[0], e[3], e[2], e[1]] : null,
    source: 'photon',
  };
}

export interface PhotonOptions {
  lat?: number;
  lng?: number;
  limit?: number;
  lang?: string;
  /** e.g. `aeroway:aerodrome` */
  osmTag?: string;
}

export async function photonSearch(q: string, opts: PhotonOptions = {}): Promise<Place[]> {
  const u = new URL(`${photonBase()}/api/`);
  u.searchParams.set('q', q.slice(0, 200));
  u.searchParams.set('limit', String(Math.min(15, opts.limit ?? 8)));
  u.searchParams.set('lang', opts.lang ?? 'en');
  if (opts.lat !== undefined && opts.lng !== undefined) {
    u.searchParams.set('lat', opts.lat.toFixed(3));
    u.searchParams.set('lon', opts.lng.toFixed(3));
  }
  if (opts.osmTag) u.searchParams.set('osm_tag', opts.osmTag);
  const key = `photon:${u.search}`;
  const hit = memGet<Place[]>(key, PHOTON_TTL_MS);
  if (hit) return hit;
  const { data } = await httpJson<{ features?: PhotonFeature[] }>(u, { timeoutMs: 6000, retries: 1 });
  const places = (data?.features ?? []).map(fromPhoton).filter((p): p is Place => p !== null);
  memSet(key, places);
  return places;
}

export async function photonReverse(lat: number, lng: number): Promise<Place | null> {
  const u = new URL(`${photonBase()}/reverse`);
  u.searchParams.set('lat', lat.toFixed(4));
  u.searchParams.set('lon', lng.toFixed(4));
  u.searchParams.set('lang', 'en');
  const key = `photon-rev:${u.search}`;
  const hit = memGet<Place | null>(key, PHOTON_TTL_MS);
  if (hit !== undefined) return hit;
  const { data } = await httpJson<{ features?: PhotonFeature[] }>(u, { timeoutMs: 6000, retries: 1 });
  const place = data?.features?.[0] ? fromPhoton(data.features[0]) : null;
  memSet(key, place);
  return place;
}

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
  type?: string;
  addresstype?: string;
  boundingbox?: [string, string, string, string];
  address?: { country_code?: string };
}

function fromNominatim(r: NominatimResult): Place {
  const bb = r.boundingbox?.map(Number);
  return {
    name: r.name || r.display_name.split(',')[0]!.trim(),
    label: r.display_name,
    lat: Number(r.lat),
    lng: Number(r.lon),
    kind: r.addresstype ?? r.type ?? 'place',
    countryCode: r.address?.country_code?.toUpperCase() ?? null,
    bbox: bb && bb.length === 4 ? [bb[2]!, bb[0]!, bb[3]!, bb[1]!] : null,
    source: 'nominatim',
  };
}

async function queued<T>(cacheKey: string, fetcher: () => Promise<T>): Promise<T> {
  const store = getStore();
  const cached = await store.get<T>(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < NOMINATIM_TTL_MS) {
    state.cached++;
    return cached.data;
  }
  const value = await state.queue.run(fetcher);
  const now = Date.now();
  await store.set(cacheKey, { data: value, fetchedAt: now, lastAttemptAt: now, error: null }, NOMINATIM_TTL_MS);
  return value;
}

/** Nominatim forward search — explicit submits only, never type-ahead. Throws QueueFullError when saturated. */
export function nominatimSearch(q: string, limit = 5): Promise<Place[]> {
  const norm = q.trim().toLowerCase().slice(0, 200);
  return queued(`nominatim:search:${norm}:${limit}`, async () => {
    const u = new URL(`${nominatimBase()}/search`);
    u.searchParams.set('q', norm);
    u.searchParams.set('format', 'jsonv2');
    u.searchParams.set('addressdetails', '1');
    u.searchParams.set('limit', String(Math.min(10, limit)));
    u.searchParams.set('accept-language', 'en');
    const { data } = await httpJson<NominatimResult[]>(u, { timeoutMs: 8000, retries: 0 });
    return (data ?? []).map(fromNominatim);
  });
}

/** Nominatim reverse, cached on a ~100 m grid for 30 days. */
export function nominatimReverse(lat: number, lng: number, zoom = 10): Promise<Place | null> {
  const la = lat.toFixed(3);
  const lo = lng.toFixed(3);
  return queued(`nominatim:reverse:${la},${lo}:${zoom}`, async () => {
    const u = new URL(`${nominatimBase()}/reverse`);
    u.searchParams.set('lat', la);
    u.searchParams.set('lon', lo);
    u.searchParams.set('zoom', String(zoom));
    u.searchParams.set('format', 'jsonv2');
    u.searchParams.set('addressdetails', '1');
    u.searchParams.set('accept-language', 'en');
    const { data } = await httpJson<NominatimResult & { error?: string }>(u, { timeoutMs: 8000, retries: 0 });
    return data && !data.error ? fromNominatim(data) : null;
  });
}

export { QueueFullError };
