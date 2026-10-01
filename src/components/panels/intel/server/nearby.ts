/**
 * In-process reads of other owners' feeds (never over HTTP): points within a radius of a location,
 * with each layer's honest state. Every layer has its own adapter for its feed's data shape:
 *  - a feed that failed (no data) is `offline` with `count: null`, never 0;
 *  - a feed that answered but whose shape is not understood is `unavailable` (state stays the
 *    feed's own state) — never reported as offline;
 *  - a cold feed still loading when the wait expires is `pending`;
 *  - keyed/licensed layers without their capability are `not-configured` / `licence`.
 * Cameras aggregate the per-region `cctv:<region>` catalogue feeds; maritime splits REFERENCE
 * ports + chokepoints from live AIS vessels; cables (REFERENCE, CC BY-NC-SA) count cables passing
 * within the radius plus landing points, gated by `nc_sources`.
 * Owner: panels-alerts-markets-dossier-graph. Server-only.
 */
import 'server-only';
import { hasCapability } from '@/lib/capabilities';
import { allFeeds, getFeed, type FeedResult } from '@/lib/feeds';
import { normalizeUtc } from '@/lib/freshness';
import { distanceKm } from '@/lib/geo';
import type { FreshnessState } from '@/lib/types';
import { CCTV_REGIONS, REGION_BOUNDS, regionsForPoint } from '@/features/surveillance/shared';

export interface Point {
  id: string;
  lat: number;
  lng: number;
  title: string;
  observedAt: string | null;
}

export type NearbyReason = 'pending' | 'unavailable' | 'not-configured' | 'licence' | 'partial';

export interface LayerNearby {
  count: number | null;
  state: FreshnessState;
  points: (Point & { distanceKm: number })[];
  reason?: NearbyReason;
  note?: string;
}

type Adapter = (data: unknown) => Point[] | null;

interface LayerDef {
  layer: string;
  /** Registry key; `cctv:*` means every per-region camera feed relevant to the point. */
  feed: string;
  adapt?: Adapter;
  /** Reference layers report state `reference` whatever the feed's poll state. */
  reference?: boolean;
  /** Capability that must be on; otherwise the layer reports this reason without reading. */
  gate?: { capability: Parameters<typeof hasCapability>[0]; reason: 'not-configured' | 'licence'; note: string };
  /** Count something other than the points (cables: cables within radius, not landing points). */
  near?: (data: unknown, lat: number, lng: number, radiusKm: number) => Omit<LayerNearby, 'state'> | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Epoch seconds, epoch ms or a (zone-less = UTC) time string → ISO (null when not a time). */
export function toIso(v: unknown): string | null {
  if (typeof v === 'string' && v) return normalizeUtc(v);
  const n = num(v);
  if (n === null || n <= 0) return null;
  const ms = n < 1e11 ? n * 1000 : n;
  return new Date(ms).toISOString();
}

function fireTitle(o: Record<string, unknown>): string | null {
  const sat = str(o.satellite);
  if (!sat) return null;
  const frp = num(o.frpMw);
  const instrument = sat === 'MODIS' || sat === 'Terra' || sat === 'Aqua' ? 'MODIS' : `VIIRS ${sat}`;
  return `${instrument} hotspot${frp !== null ? ` · FRP ${frp.toFixed(1)} MW` : ''}`;
}

export function toPoint(o: Record<string, unknown>, i: number): Point | null {
  const place = rec(o.place) as { lat?: unknown; lng?: unknown; name?: unknown } | null;
  const lat = num(o.lat) ?? num(place?.lat);
  const lng = num(o.lng) ?? num(o.lon) ?? num(place?.lng);
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const title =
    str(o.title) ?? str(o.callsign) ?? str(o.name) ?? fireTitle(o) ?? (typeof o.place === 'string' ? o.place : null) ?? str(place?.name) ?? str(o.mmsi) ?? str(o.id) ?? `#${i}`;
  const observedAt = toIso(o.observedAt) ?? toIso(o.publishedAt) ?? toIso(o.seenAt);
  return { id: str(o.id) ?? String(i), lat, lng, title: title.trim() || `#${i}`, observedAt };
}

function pointsOf(arr: unknown[]): Point[] {
  const out: Point[] = [];
  arr.forEach((o, i) => {
    const r = rec(o);
    const p = r ? toPoint(r, i) : null;
    if (p) out.push(p);
  });
  return out;
}

/** Columnar `{fields: string[], rows: unknown[][]}` → objects (the bulk response shape). */
export function decodeColumnar(d: Record<string, unknown>): Record<string, unknown>[] | null {
  const { fields, rows } = d;
  if (!Array.isArray(fields) || !Array.isArray(rows) || !fields.every((f) => typeof f === 'string')) return null;
  if (rows.length > 0 && !Array.isArray(rows[0])) return null;
  return (rows as unknown[][]).map((row) => Object.fromEntries((fields as string[]).map((f, i) => [f, row[i]])));
}

const isObjArray = (a: unknown): a is unknown[] => Array.isArray(a) && (a.length === 0 || rec(a[0]) !== null);

/**
 * Generic extractor: a bare array of objects, `{items|records|rows: [...]}` of objects, columnar
 * `{fields, rows}`, or the maritime `{ports, chokepoints, vessels}` shape. `null` = not understood.
 */
export function extractPoints(data: unknown): Point[] | null {
  if (isObjArray(data)) return pointsOf(data);
  const d = rec(data);
  if (!d) return null;
  const columnar = decodeColumnar(d);
  if (columnar) return pointsOf(columnar);
  const arr = [d.items, d.records, d.rows].find(isObjArray);
  if (arr) return pointsOf(arr);
  if (isObjArray(d.ports) || isObjArray(d.chokepoints) || isObjArray(d.vessels)) {
    return [d.ports, d.chokepoints, d.vessels].flatMap((a) => (isObjArray(a) ? pointsOf(a) : []));
  }
  return null;
}

/** Maritime REFERENCE: ports and chokepoints. */
export const adaptMaritimeReference: Adapter = (data) => {
  const d = rec(data);
  if (!d || (!isObjArray(d.ports) && !isObjArray(d.chokepoints))) return null;
  const ports = isObjArray(d.ports) ? pointsOf(d.ports).map((p) => ({ ...p, title: `Port · ${p.title}` })) : [];
  const chokes = isObjArray(d.chokepoints) ? pointsOf(d.chokepoints).map((p) => ({ ...p, title: `Chokepoint · ${p.title}` })) : [];
  return [...ports, ...chokes];
};

/** Maritime live: AIS vessels only. */
export const adaptVessels: Adapter = (data) => {
  const d = rec(data);
  return d && isObjArray(d.vessels) ? pointsOf(d.vessels) : null;
};

// ── Cables: nearest distance from a point to a polyline (local equirectangular, fine at ≤ 150 km) ──
const KM_PER_DEG = 111.32;

function segmentDistanceKm(lat: number, lng: number, a: readonly number[], b: readonly number[]): number {
  const k = Math.cos((lat * Math.PI) / 180);
  const wrap = (x: number) => ((((x % 360) + 540) % 360) - 180);
  // Wrap the first end around the query, the second around the first: a segment crossing the
  // query's opposite meridian must not be unwrapped through the query point.
  const aLng = wrap(a[0]! - lng);
  const bLng = aLng + wrap(b[0]! - a[0]!);
  const ax = aLng * k * KM_PER_DEG;
  const ay = (a[1]! - lat) * KM_PER_DEG;
  const bx = bLng * k * KM_PER_DEG;
  const by = (b[1]! - lat) * KM_PER_DEG;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

export function lineDistanceKm(lat: number, lng: number, geometry: unknown): number | null {
  const g = rec(geometry);
  if (!g) return null;
  const lines: unknown[] = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' && Array.isArray(g.coordinates) ? g.coordinates : [];
  let best = Infinity;
  for (const line of lines) {
    if (!Array.isArray(line)) continue;
    for (let i = 0; i < line.length; i++) {
      const a = line[i] as number[];
      const b = (line[i + 1] ?? line[i]) as number[];
      if (!Array.isArray(a) || !Array.isArray(b)) continue;
      // Skip segments that are clearly far (cheap reject before the projection).
      if (Math.abs(a[1]! - lat) > 5 && Math.abs(b[1]! - lat) > 5 && Math.sign(a[1]! - lat) === Math.sign(b[1]! - lat)) continue;
      best = Math.min(best, segmentDistanceKm(lat, lng, a, b));
    }
  }
  return Number.isFinite(best) ? best : null;
}

export function cablesNear(data: unknown, lat: number, lng: number, radiusKm: number): Omit<LayerNearby, 'state'> | null {
  const d = rec(data);
  if (!d || !Array.isArray(d.cables)) return null;
  const cables: (Point & { distanceKm: number })[] = [];
  for (const c of d.cables) {
    const r = rec(c);
    if (!r) continue;
    const dist = lineDistanceKm(lat, lng, r.geometry);
    if (dist === null || dist > radiusKm) continue;
    cables.push({ id: str(r.id) ?? `cable-${cables.length}`, lat, lng, title: `Cable · ${str(r.name) ?? str(r.id) ?? 'unnamed'} (nearest segment)`, observedAt: null, distanceKm: dist });
  }
  const landings = (isObjArray(d.landingPoints) ? pointsOf(d.landingPoints) : [])
    .map((p) => ({ ...p, title: `Landing point · ${p.title}`, distanceKm: distanceKm([lng, lat], [p.lng, p.lat]) }))
    .filter((p) => p.distanceKm <= radiusKm);
  cables.sort((a, b) => a.distanceKm - b.distanceKm);
  landings.sort((a, b) => a.distanceKm - b.distanceKm);
  return {
    count: cables.length,
    points: [...cables, ...landings].sort((a, b) => a.distanceKm - b.distanceKm),
    note: `${cables.length} cable${cables.length === 1 ? '' : 's'} and ${landings.length} landing point${landings.length === 1 ? '' : 's'} within ${radiusKm} km (TeleGeography, REFERENCE)`,
  };
}

/** Layer key (as shown in the dossier) → feed key and adapter. */
export const NEARBY_LAYERS: readonly LayerDef[] = [
  { layer: 'flights', feed: 'flights' },
  { layer: 'earthquakes', feed: 'earthquakes' },
  { layer: 'fires', feed: 'fires' },
  { layer: 'weather', feed: 'weather' },
  { layer: 'alerts', feed: 'news' },
  {
    layer: 'vessels',
    feed: 'maritime',
    adapt: adaptVessels,
    gate: { capability: 'ais', reason: 'not-configured', note: 'Live AIS needs AIS_API_KEY on this server' },
  },
  { layer: 'ports', feed: 'maritime', adapt: adaptMaritimeReference, reference: true },
  { layer: 'cameras', feed: 'cctv:*' },
  {
    layer: 'cables',
    feed: 'cables',
    reference: true,
    near: cablesNear,
    gate: { capability: 'nc_sources', reason: 'licence', note: 'TeleGeography cables are CC BY-NC-SA: off on commercial deployments' },
  },
  { layer: 'incidents', feed: 'gdacs' },
];

export function nearbyFromResult(result: FeedResult<unknown> | null, lat: number, lng: number, radiusKm: number, def?: Pick<LayerDef, 'adapt' | 'reference' | 'near'>): LayerNearby {
  if (!result || result.data === null) return { count: null, state: result?.meta.state ?? 'offline', points: [] };
  const state: FreshnessState = def?.reference ? 'reference' : result.meta.state;
  if (def?.near) {
    const n = def.near(result.data, lat, lng, radiusKm);
    return n ? { ...n, state } : { count: null, state, points: [], reason: 'unavailable', note: 'Feed answered in a shape this panel does not read' };
  }
  const pts = (def?.adapt ?? extractPoints)(result.data);
  if (pts === null) return { count: null, state, points: [], reason: 'unavailable', note: 'Feed answered in a shape this panel does not read' };
  const near = pts
    .map((p) => ({ ...p, distanceKm: distanceKm([lng, lat], [p.lng, p.lat]) }))
    .filter((p) => p.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
  return { count: near.length, state, points: near };
}

const STATE_RANK: Record<FreshnessState, number> = { live: 0, reference: 0, recent: 1, stale: 2, offline: 3 };

/** Combine several feeds of one layer (camera regions): counts add up, the stalest state wins. */
export function mergeNearby(parts: LayerNearby[]): LayerNearby {
  const answered = parts.filter((p) => p.count !== null);
  if (answered.length === 0) {
    if (parts.some((p) => p.reason === 'pending')) return { count: null, state: 'offline', points: [], reason: 'pending', note: 'Catalogue still loading' };
    if (parts.some((p) => p.reason === 'unavailable')) return { count: null, state: parts[0]?.state ?? 'offline', points: [], reason: 'unavailable', note: parts.find((p) => p.note)?.note };
    return { count: null, state: 'offline', points: [] };
  }
  const state = answered.reduce<FreshnessState>((s, p) => (STATE_RANK[p.state] > STATE_RANK[s] ? p.state : s), answered[0]!.state);
  const points = answered.flatMap((p) => p.points).sort((a, b) => a.distanceKm - b.distanceKm);
  const missing = parts.length - answered.length;
  return {
    count: answered.reduce((s, p) => s + (p.count ?? 0), 0),
    state,
    points,
    ...(missing > 0 ? { reason: 'partial' as const, note: `${missing} of ${parts.length} catalogue regions did not answer` } : {}),
  };
}

/** Camera catalogue regions whose box (grown by the radius) holds the point, plus the nearest one. */
export function cameraFeedKeys(lat: number, lng: number, radiusKm: number, registered: readonly string[]): string[] {
  const dLat = radiusKm / KM_PER_DEG;
  const dLng = radiusKm / (KM_PER_DEG * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  const hits = new Set<string>(regionsForPoint(lat, lng));
  for (const r of CCTV_REGIONS) {
    const [w, s, e, n] = REGION_BOUNDS[r];
    if (lat >= s - dLat && lat <= n + dLat && lng >= w - dLng && lng <= e + dLng) hits.add(r);
  }
  return [...hits].map((r) => `cctv:${r}`).filter((k) => registered.includes(k));
}

async function readFeed(key: string, waitMs: number): Promise<{ res: FeedResult<unknown> | null; pending: boolean }> {
  const f = getFeed(key);
  if (!f) return { res: null, pending: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((r) => {
    timer = setTimeout(() => r('timeout'), waitMs);
    timer.unref?.();
  });
  const res = await Promise.race([f.get().catch(() => null), timeout]);
  clearTimeout(timer);
  if (res === 'timeout') {
    const peek = f.peek();
    // Never loaded and still fetching: say so instead of calling a warming source offline.
    return { res: peek, pending: peek.data === null && peek.meta.lastGoodAt === null };
  }
  return { res, pending: false };
}

async function readLayer(def: LayerDef, lat: number, lng: number, radiusKm: number, waitMs: number): Promise<LayerNearby> {
  if (def.gate && !hasCapability(def.gate.capability)) {
    return { count: null, state: def.reference ? 'reference' : 'offline', points: [], reason: def.gate.reason, note: def.gate.note };
  }
  const keys = def.feed === 'cctv:*' ? cameraFeedKeys(lat, lng, radiusKm, allFeeds().map((f) => f.key)) : [def.feed];
  if (keys.length === 0) return { count: null, state: 'offline', points: [] };
  const parts = await Promise.all(
    keys.map(async (k) => {
      const { res, pending } = await readFeed(k, waitMs);
      if (pending) return { count: null, state: 'offline' as const, points: [], reason: 'pending' as const, note: 'Source still loading' };
      return nearbyFromResult(res, lat, lng, radiusKm, def);
    }),
  );
  return parts.length === 1 ? parts[0]! : mergeNearby(parts);
}

/** Reads each layer's feed(s) (starting them if idle) with a short wait. */
export async function nearbyAll(lat: number, lng: number, radiusKm: number, waitMs = 4000): Promise<Record<string, LayerNearby>> {
  const out: Record<string, LayerNearby> = {};
  await Promise.all(
    NEARBY_LAYERS.map(async (def) => {
      out[def.layer] = await readLayer(def, lat, lng, radiusKm, waitMs);
    }),
  );
  return out;
}
