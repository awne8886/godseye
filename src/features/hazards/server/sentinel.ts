/**
 * Sentinel-2 L2A scene lookup around a point (Copernicus Data Space Ecosystem STAC, keyless).
 * Owner: layers-hazards. Server-only.
 *
 * Probed 2026-09-30: `stac.dataspace.copernicus.eu/v1/search?collections=sentinel-2-l2a&bbox=…`
 * 200 in 3.6 s, CORS `*`, GeoJSON FeatureCollection. The `thumbnail` asset points at
 * `datahub.creodias.eu/odata/v1/Assets(<uuid>)/$value`, which 301-redirects to the same path on
 * `zipper.creodias.eu` (200 image, CORS `*`). next/image follows no redirects, so the card uses
 * the final zipper URL directly (both hosts are in IMAGE_HOSTS).
 */
import 'server-only';
import { runProvider } from '@/lib/feeds';
import { destination } from '@/lib/geo';
import { httpJson } from '@/lib/http';
import { providerBucket } from '@/lib/ratelimit';
import type { SentinelScene } from '@/lib/types';
import { lookup } from './lookup';

const STAC_SEARCH = 'https://stac.dataspace.copernicus.eu/v1/search';

export const SENTINEL_ATTRIBUTION = [
  { text: 'Contains modified Copernicus Sentinel data, processed by ESA; Copernicus Data Space Ecosystem STAC', url: 'https://dataspace.copernicus.eu/', licence: 'Copernicus open data licence' },
];

interface StacItem {
  id?: string;
  collection?: string;
  geometry?: { type?: string; coordinates?: unknown } | null;
  properties?: { datetime?: string; 'eo:cloud_cover'?: number | null; platform?: string; 'grid:code'?: string };
  assets?: Record<string, { href?: string; roles?: string[] }>;
}

/** The quicklook's final URL: datahub.creodias.eu 301 → zipper.creodias.eu (same path). */
export function quicklookUrl(href: string | undefined): string | null {
  if (!href) return null;
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  if (u.hostname === 'datahub.creodias.eu') u.hostname = 'zipper.creodias.eu';
  return u.hostname === 'zipper.creodias.eu' ? u.toString() : null;
}

/** Copernicus Browser link centred on the scene for its acquisition day. */
export function browserUrl(lat: number, lng: number, datetime: string): string {
  const day = datetime.slice(0, 10);
  const q = new URLSearchParams({
    zoom: '10',
    lat: lat.toFixed(4),
    lng: lng.toFixed(4),
    datasetId: 'S2_L2A_CDAS',
    fromTime: `${day}T00:00:00.000Z`,
    toTime: `${day}T23:59:59.999Z`,
  });
  return `https://browser.dataspace.copernicus.eu/?${q.toString()}`;
}

export function mapStac(fc: { features?: StacItem[] }, center: [number, number]): SentinelScene[] {
  const out: SentinelScene[] = [];
  for (const f of fc.features ?? []) {
    const g = f.geometry;
    const dt = f.properties?.datetime;
    if (!f.id || !dt || !g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon') || !Array.isArray(g.coordinates)) continue;
    const t = Date.parse(dt);
    if (!Number.isFinite(t)) continue;
    const cc = f.properties?.['eo:cloud_cover'];
    const iso = new Date(t).toISOString();
    out.push({
      id: f.id,
      collection: f.collection ?? 'sentinel-2-l2a',
      datetime: iso,
      cloudCover: typeof cc === 'number' && cc >= 0 && cc <= 100 ? Math.round(cc * 100) / 100 : null,
      footprint: g as GeoJSON.Polygon | GeoJSON.MultiPolygon,
      thumbnailUrl: quicklookUrl(f.assets?.thumbnail?.href),
      browserUrl: browserUrl(center[1], center[0], iso),
      platform: f.properties?.platform ?? null,
      tile: f.properties?.['grid:code'] ?? null,
    });
  }
  return out.sort((a, b) => b.datetime.localeCompare(a.datetime));
}

export function stacSearchUrl(lat: number, lng: number, radiusKm: number, days: number, now = Date.now()): string {
  const n = destination([lng, lat], 0, radiusKm)[1];
  const s = destination([lng, lat], 180, radiusKm)[1];
  const e = destination([lng, lat], 90, radiusKm)[0];
  const w = destination([lng, lat], 270, radiusKm)[0];
  const r = (v: number) => v.toFixed(4);
  const to = new Date(now);
  const from = new Date(now - days * 86_400_000);
  const q = new URLSearchParams({
    collections: 'sentinel-2-l2a',
    bbox: [w, Math.max(-90, s), e, Math.min(90, n)].map(r).join(','),
    datetime: `${from.toISOString().slice(0, 19)}Z/${to.toISOString().slice(0, 19)}Z`,
    limit: '20',
    sortby: '-properties.datetime',
  });
  return `${STAC_SEARCH}?${q.toString()}`;
}

export interface SentinelData {
  items: SentinelScene[];
  answered: boolean;
}

export async function sentinelScenes(lat: number, lng: number, radiusKm: number, days: number) {
  // Nearby requests share an answer: 0.05° (~5 km) position buckets.
  const qLat = Math.round(lat * 20) / 20;
  const qLng = Math.round(lng * 20) / 20;
  return lookup<SentinelData>(`sentinel:${qLat},${qLng},${radiusKm},${days}`, {
    feed: 'sentinel',
    ttlMs: 5 * 60_000,
    attribution: SENTINEL_ATTRIBUTION,
    isEmpty: (d) => !d.answered,
    run: async (signal) => {
      const { result, run } = await runProvider(
        async () => mapStac((await httpJson<{ features?: StacItem[] }>(stacSearchUrl(qLat, qLng, radiusKm, days), { signal, timeoutMs: 20_000, limiter: providerBucket('cdse-stac', 2, 4) })).data ?? {}, [qLng, qLat]),
        (r) => r.length,
        // No cloud-free-or-not acquisition in the window is possible (short windows, polar night).
        { allowEmpty: true },
      );
      const items = result ?? [];
      const newest = items[0] ? Date.parse(items[0].datetime) : null;
      return { data: { items, answered: run.status.ok }, providers: { cdse_stac: run }, observedAt: newest };
    },
  });
}
