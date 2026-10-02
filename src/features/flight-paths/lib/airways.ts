/**
 * FAA ADDS airways (ATS_Route, US public domain): the bundled snapshot's format, the build-time
 * helpers (429-in-200 detection, simplification, merging) and the corridor test the plan uses
 * (airways near the US part of the great circle, 50 km buffer). Pure: shared by
 * tools/build-airways.ts and the server. Owner: feature-flight-paths.
 */
import type { LngLatTuple } from '@/lib/geo';

export const FAA_ATS_ROUTE_URL = 'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/ATS_Route/FeatureServer/0';
export const AIRWAYS_FILE = 'airways-us.min.json';

export interface AirwaySource {
  url: string;
  lastModified: string | null;
}

export interface AirwayRecord {
  ident: string;
  /** FAA TYPE_CODE (e.g. 'AWY', 'RNAV', 'ATS'), as published. */
  type: string;
  lines: LngLatTuple[][];
}

export interface AirwaysFile {
  version: 1;
  generatedAt: string;
  sources: AirwaySource[];
  licence: string;
  airways: AirwayRecord[];
}

/** ArcGIS answers quota and other errors as HTTP 200 with `{error:{code}}`; the code is the real status. */
export function arcgisErrorCode(body: unknown): number | null {
  if (!body || typeof body !== 'object') return null;
  const err = (body as { error?: { code?: unknown } }).error;
  if (!err || typeof err !== 'object') return null;
  return typeof err.code === 'number' ? err.code : 500;
}

/** Douglas–Peucker in degrees (local equirectangular), keeping both ends. */
export function simplifyLine(line: readonly LngLatTuple[], tolDeg: number): LngLatTuple[] {
  if (line.length <= 2) return [...line];
  const keep = new Uint8Array(line.length);
  keep[0] = 1;
  keep[line.length - 1] = 1;
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = line[a]!;
    const [bx, by] = line[b]!;
    const k = Math.cos((((ay + by) / 2) * Math.PI) / 180);
    const dx = (bx - ax) * k;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let worst = -1;
    let worstD = tolDeg * tolDeg;
    for (let i = a + 1; i < b; i++) {
      const px = (line[i]![0] - ax) * k;
      const py = line[i]![1] - ay;
      const t = len2 > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / len2)) : 0;
      const d = (px - t * dx) ** 2 + (py - t * dy) ** 2;
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst > 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return line.filter((_, i) => keep[i] === 1);
}

const round = (v: number) => Math.round(v * 1e4) / 1e4;

interface GeoJsonFeature {
  properties?: { IDENT?: unknown; TYPE_CODE?: unknown } | null;
  geometry?: { type?: string; coordinates?: unknown } | null;
}

/** GeoJSON features (one per published segment) → airways merged by ident + type, simplified. */
export function mergeAirwayFeatures(features: readonly GeoJsonFeature[], tolDeg = 0.01): AirwayRecord[] {
  const by = new Map<string, AirwayRecord>();
  for (const f of features) {
    const ident = typeof f.properties?.IDENT === 'string' ? f.properties.IDENT.trim().toUpperCase() : '';
    if (!/^[A-Z0-9-]{1,10}$/.test(ident)) continue;
    const type = typeof f.properties?.TYPE_CODE === 'string' ? f.properties.TYPE_CODE.trim().toUpperCase().slice(0, 12) : '';
    const g = f.geometry;
    const parts = g?.type === 'LineString' ? [g.coordinates] : g?.type === 'MultiLineString' && Array.isArray(g.coordinates) ? g.coordinates : [];
    for (const raw of parts as unknown[]) {
      if (!Array.isArray(raw)) continue;
      const line = raw
        .filter((p): p is [number, number] => Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number' && Math.abs(p[1]) <= 90 && Math.abs(p[0]) <= 360)
        .map(([x, y]) => [x > 180 ? x - 360 : x, y] as LngLatTuple);
      if (line.length < 2) continue;
      const simple = simplifyLine(line, tolDeg).map(([x, y]) => [round(x), round(y)] as LngLatTuple);
      const key = `${ident}|${type}`;
      const rec = by.get(key) ?? { ident, type, lines: [] };
      rec.lines.push(simple);
      by.set(key, rec);
    }
  }
  return [...by.values()].sort((a, b) => a.ident.localeCompare(b.ident) || a.type.localeCompare(b.type));
}

/** US airspace the ATS_Route data covers (CONUS, Alaska incl. the Aleutians, Hawaii). */
export const US_BOXES: readonly [number, number, number, number][] = [
  [-125.5, 24, -66, 49.5],
  [-180, 51, -129, 72],
  [172, 51, 180, 56],
  [-161, 18, -154, 23],
];

const wrap = (x: number) => ((((x + 180) % 360) + 360) % 360) - 180;
const inUs = ([x, y]: LngLatTuple) => US_BOXES.some(([w, s, e, n]) => x >= w && x <= e && y >= s && y <= n);

/** Runs of the path (wrapped to ±180) inside US airspace; runs crossing ±180 are split there. */
export function usParts(path: readonly LngLatTuple[]): LngLatTuple[][] {
  const out: LngLatTuple[][] = [];
  let run: LngLatTuple[] = [];
  let prev: LngLatTuple | null = null;
  for (const p of path) {
    const q: LngLatTuple = [wrap(p[0]), p[1]];
    const jump = prev !== null && Math.abs(q[0] - prev[0]) > 180;
    if (!inUs(q) || jump) {
      if (run.length > 1) out.push(run);
      run = inUs(q) ? [q] : [];
    } else run.push(q);
    prev = q;
  }
  if (run.length > 1) out.push(run);
  return out;
}

const KM_PER_DEG = 111.2;

/** Distance (km) from a point to a segment, local equirectangular (fine at 50 km). */
function segDistKm(p: LngLatTuple, a: LngLatTuple, b: LngLatTuple): number {
  const k = Math.cos((p[1] * Math.PI) / 180);
  const ax = (a[0] - p[0]) * k;
  const ay = a[1] - p[1];
  const bx = (b[0] - p[0]) * k;
  const by = b[1] - p[1];
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy) * KM_PER_DEG;
}

/** Points along a line no more than `stepKm` apart (for the buffer test). */
function densify(line: readonly LngLatTuple[], stepKm: number): LngLatTuple[] {
  const out: LngLatTuple[] = [line[0]!];
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1]!;
    const [bx, by] = line[i]!;
    const km = Math.hypot((bx - ax) * Math.cos((((ay + by) / 2) * Math.PI) / 180), by - ay) * KM_PER_DEG;
    const n = Math.max(1, Math.ceil(km / stepKm));
    for (let j = 1; j <= n; j++) out.push([ax + ((bx - ax) * j) / n, ay + ((by - ay) * j) / n]);
  }
  return out;
}

export interface NearAirway {
  ident: string;
  type: string;
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString;
  /** Length (km, ≈) of the airway inside the buffer: how closely it follows the route. */
  overlapKm: number;
}

export const AIRWAY_BUFFER_KM = 50;
export const MAX_AIRWAYS = 40;
const STEP_KM = 10;

/**
 * Airways with a part inside the `bufferKm` corridor around the US portion of `path`, longest
 * overlap first (airways that follow the route before ones that merely cross it), at most `max`.
 * Only the airway lines that enter the corridor are returned.
 */
export function airwaysNear(file: Pick<AirwaysFile, 'airways'>, path: readonly LngLatTuple[], bufferKm = AIRWAY_BUFFER_KM, max = MAX_AIRWAYS): NearAirway[] {
  const parts = usParts(path);
  if (!parts.length) return [];
  const pad = bufferKm / KM_PER_DEG;
  const boxes = parts.map((r) => {
    const xs = r.map((p) => p[0]);
    const ys = r.map((p) => p[1]);
    const latMax = Math.min(89, Math.max(...ys.map(Math.abs)) + pad);
    const lngPad = pad / Math.max(0.05, Math.cos((latMax * Math.PI) / 180));
    return [Math.min(...xs) - lngPad, Math.min(...ys) - pad, Math.max(...xs) + lngPad, Math.max(...ys) + pad] as const;
  });
  const out: NearAirway[] = [];
  for (const aw of file.airways) {
    const hit: LngLatTuple[][] = [];
    let overlap = 0;
    for (const line of aw.lines) {
      const r = parts.findIndex((_, i) => {
        const [w, s, e, n] = boxes[i]!;
        return line.some(([x, y]) => x >= w && x <= e && y >= s && y <= n) || lineCrossesBox(line, boxes[i]!);
      });
      if (r < 0) continue;
      let inside = 0;
      const pts = densify(line, STEP_KM);
      for (const p of pts) {
        const part = parts[r]!;
        for (let i = 1; i < part.length; i++) {
          if (segDistKm(p, part[i - 1]!, part[i]!) <= bufferKm) {
            inside++;
            break;
          }
        }
      }
      if (inside) {
        hit.push(line);
        overlap += Math.max(0, inside - 1) * STEP_KM;
      }
    }
    if (!hit.length) continue;
    out.push({
      ident: aw.ident,
      type: aw.type,
      geometry: hit.length === 1 ? { type: 'LineString', coordinates: hit[0]! } : { type: 'MultiLineString', coordinates: hit },
      overlapKm: overlap,
    });
  }
  return out.sort((a, b) => b.overlapKm - a.overlapKm || a.ident.localeCompare(b.ident)).slice(0, max);
}

/** A line whose bbox overlaps the box (a long segment can pass through without a vertex inside). */
function lineCrossesBox(line: readonly LngLatTuple[], [w, s, e, n]: readonly [number, number, number, number]): boolean {
  const xs = line.map((p) => p[0]);
  const ys = line.map((p) => p[1]);
  return Math.min(...xs) <= e && Math.max(...xs) >= w && Math.min(...ys) <= n && Math.max(...ys) >= s;
}
