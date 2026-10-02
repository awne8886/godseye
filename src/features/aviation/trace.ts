/**
 * readsb trace files (adsb.lol `/data/traces/{hex[-2:]}/trace_{full|recent}_{hex}.json`) → the
 * current leg of the flown track. Undocumented format (docs/reference/03 §8, probed 2026-09-30):
 * `{icao, r, t, desc, dbFlags, timestamp, trace: [[Δs, lat, lon, alt_ft|'ground'|null, gs, track,
 * flags, baro_rate, details|null, source, alt_geom, geom_rate, ias, roll], …]}` where Δs is seconds
 * after `timestamp` (epoch seconds) and `flags & 2` marks the start of a new leg. `trace_full` lags
 * by a few minutes; `trace_recent` holds the last few minutes, so both are merged. Pure/isomorphic.
 */
import type { z } from 'zod';
import type { TrackPoint as TrackPointSchema } from '@/lib/schemas/aviation';

export type TrackPoint = z.infer<typeof TrackPointSchema>;

export interface TraceFile {
  icao?: string;
  r?: string;
  t?: string;
  desc?: string;
  dbFlags?: number;
  timestamp?: number;
  trace?: unknown[];
}

export interface TraceRow {
  /** Epoch ms. */
  at: number;
  lat: number;
  lng: number;
  altFt: number | null;
  onGround: boolean;
  gsKt: number | null;
  trackDeg: number | null;
  newLeg: boolean;
  source: string | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function parseTrace(file: TraceFile | undefined | null): TraceRow[] {
  const base = num(file?.timestamp);
  if (base === null || !Array.isArray(file?.trace)) return [];
  const out: TraceRow[] = [];
  for (const raw of file.trace) {
    if (!Array.isArray(raw)) continue;
    const dt = num(raw[0]);
    const lat = num(raw[1]);
    const lng = num(raw[2]);
    if (dt === null || lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const alt = raw[3];
    const track = num(raw[5]);
    const flags = num(raw[6]) ?? 0;
    out.push({
      at: Math.round((base + dt) * 1000),
      lat,
      lng,
      altFt: num(alt),
      onGround: alt === 'ground',
      gsKt: num(raw[4]),
      trackDeg: track === null ? null : ((track % 360) + 360) % 360,
      newLeg: (flags & 2) !== 0,
      source: typeof raw[9] === 'string' ? raw[9] : null,
    });
  }
  return out;
}

/** Full trace + recent tail, ordered by time, without duplicates. */
export function mergeTraces(full: readonly TraceRow[], recent: readonly TraceRow[]): TraceRow[] {
  const last = full.length ? full[full.length - 1]!.at : -Infinity;
  return [...full, ...recent.filter((r) => r.at > last)];
}

/**
 * The current leg: rewind past trailing ground rows, then walk back to the previous run of at least
 * `minGroundRun` consecutive ground samples (or a readsb new-leg flag). Returns every row when the
 * leg would be shorter than 2 points.
 */
export function currentLeg(rows: readonly TraceRow[], minGroundRun = 4): TraceRow[] {
  if (rows.length < 2) return [...rows];
  let end = rows.length - 1;
  while (end > 0 && rows[end]!.onGround) end--;
  let start = 0;
  let run = 0;
  for (let i = end; i >= 0; i--) {
    const r = rows[i]!;
    if (r.onGround) {
      run++;
      if (run >= minGroundRun) {
        start = i + run - 1; // the last ground sample before take-off
        break;
      }
    } else {
      run = 0;
      if (r.newLeg && i < end) {
        start = i;
        break;
      }
    }
  }
  // Trailing ground rows stay: after landing, the roll-out belongs to this leg.
  const leg = rows.slice(start);
  return leg.length >= 2 ? leg : [...rows];
}

/** Keep at most `max` points, always keeping the first and last. */
export function downsample<T>(points: readonly T[], max = 700): T[] {
  if (points.length <= max) return [...points];
  const out: T[] = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max - 1; i++) out.push(points[Math.round(i * step)]!);
  out.push(points[points.length - 1]!);
  return out;
}

export function toTrackPoints(rows: readonly TraceRow[]): TrackPoint[] {
  return rows.map((r) => ({
    t: new Date(r.at).toISOString(),
    lat: Math.round(r.lat * 1e5) / 1e5,
    lng: Math.round(r.lng * 1e5) / 1e5,
    altFt: r.onGround ? null : r.altFt,
    onGround: r.onGround,
    gsKt: r.gsKt,
    trackDeg: r.trackDeg === null ? null : (Math.round(r.trackDeg * 10) / 10) % 360,
  }));
}

/** Position source of the newest row (readsb `adsb_icao`, `mlat`, `tisb_icao`, …). */
export function latestSource(rows: readonly TraceRow[]): string | null {
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i]!.source) return rows[i]!.source;
  return null;
}
