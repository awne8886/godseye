/**
 * In-process reads of other owners' feeds (never over HTTP): points within a radius of a location,
 * with each layer's honest state. A layer whose feed is not registered in this process or has no
 * data is reported with `count: null` and its state (`offline`), never as 0.
 * Owner: panels-alerts-markets-dossier-graph. Server-only.
 */
import 'server-only';
import { getFeed, type FeedResult } from '@/lib/feeds';
import { distanceKm } from '@/lib/geo';
import type { FreshnessState } from '@/lib/types';

export interface Point {
  id: string;
  lat: number;
  lng: number;
  title: string;
  observedAt: string | null;
}

/** Layer key (as shown in the dossier) → feed key in the registry. */
export const NEARBY_LAYERS: readonly { layer: string; feed: string }[] = [
  { layer: 'flights', feed: 'flights' },
  { layer: 'earthquakes', feed: 'earthquakes' },
  { layer: 'fires', feed: 'fires' },
  { layer: 'weather', feed: 'weather' },
  { layer: 'alerts', feed: 'news' },
  { layer: 'maritime', feed: 'maritime' },
  { layer: 'cameras', feed: 'cctv' },
  { layer: 'incidents', feed: 'gdacs' },
];

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

function toPoint(o: Record<string, unknown>, i: number): Point | null {
  const place = o.place as { lat?: unknown; lng?: unknown; name?: unknown } | null | undefined;
  const lat = typeof o.lat === 'number' ? o.lat : typeof place?.lat === 'number' ? place.lat : null;
  const lng = typeof o.lng === 'number' ? o.lng : typeof o.lon === 'number' ? o.lon : typeof place?.lng === 'number' ? place.lng : null;
  if (lat === null || lng === null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const title = str(o.title) ?? str(o.callsign) ?? str(o.name) ?? (typeof o.place === 'string' ? o.place : null) ?? str(o.id) ?? `#${i}`;
  const observedAt = str(o.observedAt) ?? str(o.publishedAt);
  return { id: str(o.id) ?? String(i), lat, lng, title: title.trim() || `#${i}`, observedAt };
}

/** Accepts `{items: [...]}`, `{records: [...]}` or `{rows: [...]}` of objects with lat/lng (or place.lat/lng). */
export function extractPoints(data: unknown): Point[] | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const arr = [d.items, d.records, d.rows].find((a) => Array.isArray(a) && (a.length === 0 || (typeof a[0] === 'object' && a[0] !== null && !Array.isArray(a[0])))) as Record<string, unknown>[] | undefined;
  if (!arr) return null;
  const out: Point[] = [];
  arr.forEach((o, i) => {
    const p = toPoint(o, i);
    if (p) out.push(p);
  });
  return out;
}

export interface LayerNearby {
  count: number | null;
  state: FreshnessState;
  points: (Point & { distanceKm: number })[];
}

export function nearbyFromResult(result: FeedResult<unknown> | null, lat: number, lng: number, radiusKm: number): LayerNearby {
  if (!result || result.data === null) return { count: null, state: result?.meta.state ?? 'offline', points: [] };
  const pts = extractPoints(result.data);
  if (pts === null) return { count: null, state: 'offline', points: [] };
  const near = pts
    .map((p) => ({ ...p, distanceKm: distanceKm([lng, lat], [p.lng, p.lat]) }))
    .filter((p) => p.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
  return { count: near.length, state: result.meta.state, points: near };
}

/** Reads each registered feed (starting it if idle) with a short wait; unregistered → offline. */
export async function nearbyAll(lat: number, lng: number, radiusKm: number, waitMs = 4000): Promise<Record<string, LayerNearby>> {
  const out: Record<string, LayerNearby> = {};
  await Promise.all(
    NEARBY_LAYERS.map(async ({ layer, feed }) => {
      const f = getFeed(feed);
      if (!f) {
        out[layer] = { count: null, state: 'offline', points: [] };
        return;
      }
      const timeout = new Promise<null>((r) => setTimeout(() => r(null), waitMs).unref?.());
      const res = await Promise.race([f.get().catch(() => null), timeout]);
      out[layer] = nearbyFromResult(res ?? f.peek(), lat, lng, radiusKm);
    }),
  );
  return out;
}
