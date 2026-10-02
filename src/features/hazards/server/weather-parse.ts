/**
 * Severe-weather normalisers: NWS alerts, GDACS event list, NHC current storms + cones, Smithsonian
 * GVP weekly RSS. Pure; unit-tested against recorded payloads (2026-09-30). Owner: layers-hazards.
 */
import { normalizeUtc } from '@/lib/freshness';
import { parseFeed, tagText, toPlainText } from '@/lib/rss';
import type { WeatherEvent } from '@/lib/types';
import { windSeverity } from './eonet-parse';

type Geo = GeoJSON.Polygon | GeoJSON.MultiPolygon;

const isoOrNull = (v: string | null | undefined): string | null => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
const httpUrl = (v: unknown): string | null => (typeof v === 'string' && /^https?:\/\/[^\s]+$/i.test(v) ? v : null);
const clip = (s: string, n = 280) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

// ── Geometry helpers ─────────────────────────────────────────────────────────────
/** Area-weighted centroid of a ring (shoelace); falls back to the vertex mean for degenerate rings. */
export function ringCentroid(ring: readonly GeoJSON.Position[]): [number, number] | null {
  if (ring.length < 3) return null;
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0 = 0, y0 = 0] = ring[i]!;
    const [x1 = 0, y1 = 0] = ring[i + 1]!;
    const f = x0 * y1 - x1 * y0;
    a += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-12) {
    const n = ring.length;
    return [ring.reduce((s, p) => s + (p[0] ?? 0), 0) / n, ring.reduce((s, p) => s + (p[1] ?? 0), 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

const ringArea = (ring: readonly GeoJSON.Position[]) => {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) a += (ring[i]![0] ?? 0) * (ring[i + 1]![1] ?? 0) - (ring[i + 1]![0] ?? 0) * (ring[i]![1] ?? 0);
  return Math.abs(a / 2);
};

/** Centroid of the largest outer ring of a (Multi)Polygon. */
export function geometryCentroid(g: Geo): [number, number] | null {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  let best: GeoJSON.Position[] | null = null;
  let bestArea = -1;
  for (const p of polys) {
    const outer = p[0];
    if (!outer) continue;
    const area = ringArea(outer);
    if (area > bestArea) {
      bestArea = area;
      best = outer;
    }
  }
  return best ? ringCentroid(best) : null;
}

/**
 * Display simplification for zone/cone outlines: round to `decimals` and drop consecutive
 * duplicates (keeps every ring closed and ≥ 4 positions; a ring that would collapse keeps 3 more
 * decimals). This only thins vertices of a boundary; it never moves or invents an event.
 */
export function simplifyGeometry(g: Geo, decimals = 2): Geo {
  const f = 10 ** decimals;
  const ring = (r: GeoJSON.Position[]): GeoJSON.Position[] => {
    const out: GeoJSON.Position[] = [];
    for (const p of r) {
      const q = [Math.round((p[0] ?? 0) * f) / f, Math.round((p[1] ?? 0) * f) / f];
      const last = out[out.length - 1];
      if (!last || last[0] !== q[0] || last[1] !== q[1]) out.push(q);
    }
    if (out.length && (out[0]![0] !== out[out.length - 1]![0] || out[0]![1] !== out[out.length - 1]![1])) out.push([...out[0]!]);
    return out.length >= 4 ? out : decimals < 5 ? (simplifyGeometry({ type: 'Polygon', coordinates: [r] }, decimals + 3) as GeoJSON.Polygon).coordinates[0]! : r;
  };
  return g.type === 'Polygon'
    ? { type: 'Polygon', coordinates: g.coordinates.map(ring) }
    : { type: 'MultiPolygon', coordinates: g.coordinates.map((p) => p.map(ring)) };
}

/** Perpendicular distance² of p from segment a–b (planar degrees; display thinning only). */
function segDist2(p: GeoJSON.Position, a: GeoJSON.Position, b: GeoJSON.Position): number {
  const [px = 0, py = 0] = p;
  const [ax = 0, ay = 0] = a;
  const [bx = 0, by = 0] = b;
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  const ex = ax + t * dx - px;
  const ey = ay + t * dy - py;
  return ex * ex + ey * ey;
}

/** Douglas-Peucker over an open polyline; returns the kept indices (iterative, no recursion depth). */
function dpKeep(pts: readonly GeoJSON.Position[], tol2: number, keep: Uint8Array, from: number, to: number): void {
  const stack: [number, number][] = [[from, to]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let best = -1;
    let bestD = tol2;
    for (let i = a + 1; i < b; i++) {
      const d = segDist2(pts[i]!, pts[a]!, pts[b]!);
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) continue;
    keep[best] = 1;
    stack.push([a, best], [best, b]);
  }
}

/**
 * Douglas-Peucker for a closed ring at `tol` degrees. The ring is split at its first vertex and
 * the vertex farthest from it, so both halves keep their extremes. Always returns a valid closed
 * ring (≥ 4 positions): a zone smaller than the tolerance keeps its three most extreme vertices
 * instead of collapsing to nothing. Rings that are already invalid are returned unchanged.
 */
export function simplifyRing(ring: readonly GeoJSON.Position[], tol: number): GeoJSON.Position[] {
  const n = ring.length - 1; // distinct vertices (closed ring repeats the first)
  if (n < 4) return ring.map((p) => [...p]);
  const pts = ring.slice(0, n);
  let far = 0;
  let farD = -1;
  for (let i = 1; i < n; i++) {
    const d = segDist2(pts[i]!, pts[0]!, pts[0]!);
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const closed = [...pts, pts[0]!];
  const keep = new Uint8Array(n + 1);
  keep[0] = keep[far] = keep[n] = 1;
  const tol2 = tol * tol;
  dpKeep(closed, tol2, keep, 0, far);
  dpKeep(closed, tol2, keep, far, n);
  let out = closed.filter((_, i) => keep[i]);
  if (out.length < 4) {
    // Tiny zone: keep a triangle of its extremes (first, farthest, farthest from that chord).
    let third = -1;
    let thirdD = -1;
    for (let i = 1; i < n; i++) {
      if (i === far) continue;
      const d = segDist2(pts[i]!, pts[0]!, pts[far]!);
      if (d > thirdD) {
        thirdD = d;
        third = i;
      }
    }
    out = [0, far, third].filter((i) => i >= 0).sort((a, b) => a - b).map((i) => pts[i]!);
    out.push(pts[0]!);
  }
  return out.map((p) => [...p]);
}

export const vertexCount = (g: Geo): number =>
  g.type === 'Polygon' ? g.coordinates.reduce((s, r) => s + r.length, 0) : g.coordinates.reduce((s, p) => s + p.reduce((t, r) => t + r.length, 0), 0);

/** Display tolerance (degrees, ~1.1 km) and per-outline vertex cap for NWS zones / alert polygons / NHC cones. */
export const THIN_TOLERANCE_DEG = 0.01;
export const MAX_OUTLINE_VERTICES = 400;

/**
 * Display thinning for an outline: round (`simplifyGeometry`), then Douglas-Peucker at `tol` per
 * ring; while the outline still has more than `maxVertices` positions the tolerance doubles (a
 * ring never drops below 4 positions, so a many-part zone can stay above the cap). Moves no event
 * and drops no part: every ring of the input is still there.
 */
export function thinGeometry(g: Geo, tol = THIN_TOLERANCE_DEG, maxVertices = MAX_OUTLINE_VERTICES, decimals = 2): Geo {
  const rounded = simplifyGeometry(g, decimals);
  let t = tol;
  for (let pass = 0; ; pass++) {
    const thin = (r: GeoJSON.Position[]) => simplifyRing(r, t);
    const out: Geo =
      rounded.type === 'Polygon'
        ? { type: 'Polygon', coordinates: rounded.coordinates.map(thin) }
        : { type: 'MultiPolygon', coordinates: rounded.coordinates.map((p) => p.map(thin)) };
    if (vertexCount(out) <= maxVertices || pass >= 8) return out;
    t *= 2;
  }
}

// ── NWS ─────────────────────────────────────────────────────────────────────────
/**
 * NWS active alerts. §6.2: api.weather.gov REJECTS a `limit` parameter (400) and requires an
 * identifying User-Agent (http.ts always sends ours).
 */
export const NWS_ALERTS_URL = 'https://api.weather.gov/alerts/active?status=actual&message_type=alert';

export interface NwsFeature {
  geometry?: Geo | { type: string; coordinates: unknown } | null;
  properties?: {
    id?: string;
    '@id'?: string;
    event?: string;
    headline?: string | null;
    severity?: string;
    sent?: string;
    effective?: string;
    expires?: string | null;
    ends?: string | null;
    areaDesc?: string;
    affectedZones?: string[];
    geocode?: { UGC?: string[] };
  };
}

export interface NwsCollection {
  features?: NwsFeature[];
}

export function nwsType(event: string): WeatherEvent['type'] {
  const e = event.toLowerCase();
  if (/hurricane|tropical storm|typhoon|tropical depression/.test(e)) return 'tropical_cyclone';
  if (/tornado|thunderstorm|severe weather|derecho|extreme wind|high wind|dust storm/.test(e)) return 'severe_storm';
  if (/flood|hydrologic|surge|tsunami/.test(e)) return 'flood';
  if (/winter|blizzard|ice storm|snow|freeze|frost|wind chill|cold/.test(e)) return 'winter_storm';
  if (/heat/.test(e)) return 'heat';
  if (/red flag|fire weather|fire warning/.test(e)) return 'wildfire';
  if (/volcan|ashfall/.test(e)) return 'volcano';
  if (/drought/.test(e)) return 'drought';
  return 'weather_alert';
}

export function nwsSeverity(s: string | undefined): WeatherEvent['severity'] {
  switch ((s ?? '').toLowerCase()) {
    case 'extreme':
    case 'severe':
      return 'high';
    case 'moderate':
      return 'medium';
    default:
      return 'low';
  }
}

export interface ZoneGeom {
  id: string;
  name: string | null;
  centroid: [number, number];
  geometry: Geo;
}

const isPolygonal = (g: unknown): g is Geo =>
  !!g && typeof g === 'object' && ((g as Geo).type === 'Polygon' || (g as Geo).type === 'MultiPolygon') && Array.isArray((g as Geo).coordinates);

/** The zone URLs an alert needs resolved (only alerts without their own geometry). */
export function zonesNeeded(fc: NwsCollection): string[] {
  const out = new Set<string>();
  for (const f of fc.features ?? []) {
    if (isPolygonal(f.geometry)) continue;
    for (const z of f.properties?.affectedZones ?? []) if (z.startsWith('https://api.weather.gov/zones/')) out.add(z);
  }
  return [...out];
}

/**
 * Key of a zone in the response's shared `zones` map: its UGC code (`TXZ123`, `ILC007`) for
 * forecast and county zones; other zone types (fire, …) can reuse a forecast zone's code with a
 * different outline, so they are prefixed with their type (`fire/CAZ211`).
 */
export function zoneKey(url: string, zone: Pick<ZoneGeom, 'id'>): string {
  const type = /\/zones\/([^/]+)\//.exec(url)?.[1] ?? 'forecast';
  return type === 'forecast' || type === 'county' ? zone.id : `${type}/${zone.id}`;
}

// Thinned outlines per cached zone object (zones live 30 days in nws-zones; thin each once).
const THINNED = new WeakMap<ZoneGeom, Geo>();
const thinnedZone = (z: ZoneGeom): Geo => {
  let g = THINNED.get(z);
  if (!g) THINNED.set(z, (g = thinGeometry(z.geometry)));
  return g;
};

/**
 * Alerts with their own polygon use it (thinned for display); the rest are placed on their
 * affected zones' geometry (from the 30-day zone cache): position = the zone centroid nearest the
 * mean of the resolved centroids, footprint = the zones' outlines. Each zone outline is returned
 * once in `zones` (keyed by `zoneKey`) and the alert lists its keys in `zoneRefs`, so alerts on
 * the same zones do not repeat the same outlines. Alerts whose zones are not resolved yet are
 * returned as `unplaced` (never guessed).
 */
export function normalizeNws(
  fc: NwsCollection,
  zones: ReadonlyMap<string, ZoneGeom>,
): { items: WeatherEvent[]; unplaced: number; zones: Record<string, Geo> } {
  const items: WeatherEvent[] = [];
  const shapes: Record<string, Geo> = {};
  let unplaced = 0;
  for (const f of fc.features ?? []) {
    const p = f.properties ?? {};
    if (!p.id || !p.event) continue;
    const base = {
      id: `nws-${p.id}`,
      observedAt: isoOrNull(p.sent ?? p.effective),
      source: 'nws',
      title: p.headline || p.event,
      type: nwsType(p.event),
      severity: nwsSeverity(p.severity),
      provider: 'NOAA/NWS' as const,
      expiresAt: isoOrNull(p.ends ?? p.expires),
      area: p.areaDesc ?? null,
      url: httpUrl(p['@id']),
      zones: p.geocode?.UGC ?? [],
      detail: p.event,
    };
    if (isPolygonal(f.geometry)) {
      const c = geometryCentroid(f.geometry);
      if (!c) continue;
      items.push({ ...base, lng: c[0], lat: c[1], geometry: thinGeometry(f.geometry), positionBasis: 'geometry' });
      continue;
    }
    const resolved = (p.affectedZones ?? []).flatMap((u) => {
      const z = zones.get(u);
      return z ? [{ key: zoneKey(u, z), z }] : [];
    });
    if (!resolved.length) {
      unplaced++;
      continue;
    }
    const mx = resolved.reduce((s, r) => s + r.z.centroid[0], 0) / resolved.length;
    const my = resolved.reduce((s, r) => s + r.z.centroid[1], 0) / resolved.length;
    const anchor = resolved.reduce((a, b) => (Math.hypot(b.z.centroid[0] - mx, b.z.centroid[1] - my) < Math.hypot(a.z.centroid[0] - mx, a.z.centroid[1] - my) ? b : a)).z;
    const refs: string[] = [];
    for (const r of resolved) {
      shapes[r.key] ??= thinnedZone(r.z);
      if (!refs.includes(r.key)) refs.push(r.key);
    }
    items.push({ ...base, lng: anchor.centroid[0], lat: anchor.centroid[1], geometry: null, zoneRefs: refs, positionBasis: 'zone-centroid' });
  }
  return { items, unplaced, zones: shapes };
}

/** api.weather.gov `/zones/{type}/{id}` → ZoneGeom (simplified outline + centroid). */
export function parseZone(url: string, body: { geometry?: unknown; properties?: { id?: string; name?: string } }): ZoneGeom | null {
  if (!isPolygonal(body.geometry)) return null;
  const geometry = simplifyGeometry(body.geometry);
  const c = geometryCentroid(body.geometry);
  if (!c) return null;
  return { id: body.properties?.id ?? url.split('/').pop() ?? url, name: body.properties?.name ?? null, centroid: [Math.round(c[0] * 1e4) / 1e4, Math.round(c[1] * 1e4) / 1e4], geometry };
}

// ── GDACS ───────────────────────────────────────────────────────────────────────
/**
 * GDACS event list. The `/events/geteventlist/MAP` endpoint answers 400; `SEARCH?eventlist=` is the
 * working one (probed 2026-09-30, 200, 89 events, CORS `*`). Dates are zone-less UTC →
 * normalizeUtc(); alert levels arrive capitalised (`Orange`) and are lower-cased here.
 */
export const GDACS_URL = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=EQ;TC;FL;VO;DR;WF';

export interface GdacsFeature {
  geometry?: { type?: string; coordinates?: number[] } | null;
  properties?: {
    eventtype?: string;
    eventid?: number | string;
    episodeid?: number | string;
    name?: string;
    description?: string;
    alertlevel?: string;
    country?: string;
    fromdate?: string;
    todate?: string;
    datemodified?: string;
    url?: { report?: string };
    severitydata?: { severitytext?: string };
  };
}

const GDACS_TYPE: Record<string, WeatherEvent['type']> = { TC: 'tropical_cyclone', FL: 'flood', VO: 'volcano', DR: 'drought', WF: 'wildfire' };

export function normalizeGdacs(fc: { features?: GdacsFeature[] }): WeatherEvent[] {
  const out: WeatherEvent[] = [];
  const seen = new Set<string>();
  for (const f of fc.features ?? []) {
    const p = f.properties ?? {};
    const kind = (p.eventtype ?? '').toUpperCase();
    // Earthquakes are the USGS layer's job; GDACS EQ would duplicate them on the map.
    const type = GDACS_TYPE[kind];
    if (!type || p.eventid === undefined) continue;
    const [lng, lat] = f.geometry?.type === 'Point' ? (f.geometry.coordinates ?? []) : [];
    if (typeof lat !== 'number' || typeof lng !== 'number' || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const id = `gdacs-${kind}-${p.eventid}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const level = (p.alertlevel ?? '').toLowerCase();
    out.push({
      id,
      lat,
      lng,
      observedAt: normalizeUtc(p.datemodified ?? p.todate ?? p.fromdate),
      source: 'gdacs',
      title: p.name || p.description || `${kind} ${p.eventid}`,
      type,
      severity: level === 'red' ? 'high' : level === 'orange' ? 'medium' : 'low',
      provider: 'GDACS',
      expiresAt: null,
      area: p.country || null,
      url: httpUrl(p.url?.report),
      geometry: null,
      positionBasis: 'point',
      alertLevel: level === 'red' || level === 'orange' || level === 'green' ? level : undefined,
      detail: p.severitydata?.severitytext ? clip(p.severitydata.severitytext) : undefined,
    });
  }
  return out;
}

// ── NHC ─────────────────────────────────────────────────────────────────────────
export const NHC_STORMS_URL = 'https://www.nhc.noaa.gov/CurrentStorms.json';
const NHC_MAPSERVER = 'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer';

/** Forecast-cone layer ids per storm bin (from the MapServer `layers` listing, 2026-09-30). */
const CONE_BASE: Record<string, number> = { AT: 8, EP: 138, CP: 268 };

export function coneLayerId(bin: string): number | null {
  const m = /^(AT|EP|CP)([1-5])$/.exec(bin.toUpperCase());
  if (!m) return null;
  return CONE_BASE[m[1]!]! + 26 * (Number(m[2]) - 1);
}

export function coneQueryUrl(bin: string): string | null {
  const id = coneLayerId(bin);
  return id === null ? null : `${NHC_MAPSERVER}/${id}/query?where=1%3D1&outFields=*&f=geojson`;
}

export interface NhcStorm {
  id?: string;
  binNumber?: string;
  name?: string;
  classification?: string;
  intensity?: string | number;
  pressure?: string | number;
  latitudeNumeric?: number;
  longitudeNumeric?: number;
  lastUpdate?: string;
  publicAdvisory?: { url?: string };
  forecastGraphics?: { url?: string };
}

const NHC_CLASS: Record<string, string> = {
  TD: 'Tropical Depression',
  TS: 'Tropical Storm',
  HU: 'Hurricane',
  STD: 'Subtropical Depression',
  STS: 'Subtropical Storm',
  PTC: 'Post-Tropical Cyclone',
  PC: 'Potential Tropical Cyclone',
  TY: 'Typhoon',
};

export function normalizeNhc(res: { activeStorms?: NhcStorm[] }, cones: ReadonlyMap<string, Geo> = new Map()): WeatherEvent[] {
  const out: WeatherEvent[] = [];
  for (const s of res.activeStorms ?? []) {
    const lat = s.latitudeNumeric;
    const lng = s.longitudeNumeric;
    if (!s.id || typeof lat !== 'number' || typeof lng !== 'number') continue;
    const kt = Number(s.intensity);
    const cls = NHC_CLASS[(s.classification ?? '').toUpperCase()] ?? s.classification ?? 'Storm';
    out.push({
      id: `nhc-${s.id}`,
      lat,
      lng,
      observedAt: isoOrNull(s.lastUpdate),
      source: 'nhc',
      title: `${cls} ${s.name ?? s.id}`.trim(),
      type: 'tropical_cyclone',
      severity: windSeverity(Number.isFinite(kt) ? kt : null),
      provider: 'NHC',
      expiresAt: null,
      area: s.binNumber ?? null,
      url: httpUrl(s.publicAdvisory?.url) ?? httpUrl(s.forecastGraphics?.url),
      geometry: (s.binNumber && cones.get(s.binNumber.toUpperCase())) || null,
      positionBasis: 'point',
      detail: [Number.isFinite(kt) ? `${kt} kt` : null, s.pressure ? `${s.pressure} mb` : null].filter(Boolean).join(' · ') || undefined,
    });
  }
  return out;
}

/** First polygonal feature of a MapServer `f=geojson` query answer (the 5-day cone). */
export function parseCone(fc: { features?: { geometry?: unknown }[] }): Geo | null {
  for (const f of fc.features ?? []) if (isPolygonal(f.geometry)) return thinGeometry(f.geometry, THIN_TOLERANCE_DEG / 2, MAX_OUTLINE_VERTICES, 3);
  return null;
}

// ── Smithsonian GVP ─────────────────────────────────────────────────────────────
export const GVP_URL = 'https://volcano.si.edu/news/WeeklyVolcanoRSS.xml';

/** Decode the RSS bytes with the charset its XML declaration names (GVP: ISO-8859-1). */
export function decodeXml(buf: Buffer): string {
  const head = buf.subarray(0, 200).toString('latin1');
  const enc = /encoding\s*=\s*["']([^"']+)["']/i.exec(head)?.[1]?.toLowerCase() ?? 'utf-8';
  if (enc === 'iso-8859-1' || enc === 'latin1' || enc === 'windows-1252') return new TextDecoder('windows-1252').decode(buf);
  return buf.toString('utf8');
}

export function gvpSeverity(title: string): WeatherEvent['severity'] {
  if (/new eruptive activity/i.test(title)) return 'high';
  if (/eruptive activity/i.test(title)) return 'medium';
  return 'low';
}

export function normalizeGvp(xml: string): WeatherEvent[] {
  const out: WeatherEvent[] = [];
  const seen = new Set<string>();
  for (const it of parseFeed(xml)) {
    const pt = tagText(it.raw, 'georss:point')?.trim().split(/\s+/).map(Number) ?? [];
    const [lat, lng] = pt;
    if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const anchor = it.guid?.split('#')[1] ?? null;
    const id = `gvp-${anchor ?? `${lat},${lng}`}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const country = /\(([^)]+)\)/.exec(it.title)?.[1] ?? null;
    const detail = toPlainText(it.description);
    out.push({
      id,
      lat,
      lng,
      observedAt: it.publishedAt,
      source: 'gvp',
      title: it.title,
      type: 'volcano',
      severity: gvpSeverity(it.title),
      provider: 'Smithsonian GVP',
      expiresAt: null,
      area: country,
      url: httpUrl(it.guid) ?? it.link,
      geometry: null,
      positionBasis: 'point',
      detail: detail ? clip(detail) : undefined,
    });
  }
  return out;
}
