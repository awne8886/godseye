/**
 * Watched-aircraft trails for the deck TripsLayer (§7): the observed flown track (adsb.lol trace,
 * via /api/aircraft) with per-vertex timestamps, ending at the aircraft's dead-reckoned head. Pure.
 *
 * Time base: deck uploads timestamps as float32, so epoch seconds (~1.8e9, 128 s resolution in
 * float32) would smear the trail. Every timestamp is seconds after `baseMs` (the earliest drawn
 * vertex), and `currentTime` is the newest head on the same base: TripsLayer hides vertices newer
 * than `currentTime` and fades/hides those older than `currentTime - trailLength`.
 *
 * Head (§0): only an observed position moved along its own reported track and speed for at most
 * MAX_DEAD_RECKON_S after `seenAt` — the same rule as the aircraft icon — stamped with the time it
 * represents (seenAt + the reckoned seconds), never "now" past the cap.
 *
 * Far side: the trail draws with `depthCompare: 'always'` like the icons, so vertices behind the
 * limb are cut here with `isFacing()` (the vertex's own altitude lifts it over the limb first),
 * splitting the trail into the camera-facing runs. Runs are also split at the antimeridian with an
 * interpolated vertex and timestamp (mercator would otherwise draw a line across the world).
 */
import { destination } from '@/lib/geo';
import { isFacing, type FarSideCamera } from '@/lib/map/far-side';
import type { FlightRecord } from '../adsb';
import { MAX_DEAD_RECKON_S } from '../codec';
import type { TrackPoint } from '../trace';

/** §7: watched trails show the last 30 minutes of flight. */
export const TRAIL_LENGTH_S = 30 * 60;

const FT_TO_M = 0.3048;
const KT_TO_KMH = 1.852;

export interface Trip {
  hex: string;
  path: [number, number][];
  /** Seconds after `TripSet.baseMs`, one per path vertex, non-decreasing. */
  timestamps: number[];
}

export interface TripSet {
  trips: Trip[];
  baseMs: number;
  /** The newest head, seconds after `baseMs`. */
  currentTime: number;
}

interface Vertex {
  lng: number;
  lat: number;
  altM: number;
  t: number;
}

/** The dead-reckoned head of an observed record at `nowMs` (null if it has no usable time). */
export function headOf(r: FlightRecord, nowMs: number): Vertex | null {
  const seenMs = r.seenAt * 1000;
  if (!Number.isFinite(seenMs)) return null;
  const altM = r.onGround ? 0 : Math.max(0, r.altGeomFt ?? r.altFt ?? 0) * FT_TO_M;
  const moves = !r.onGround && r.gsKt !== null && r.trackDeg !== null && r.gsKt > 0;
  const dt = Math.min(Math.max(0, nowMs - seenMs) / 1000, MAX_DEAD_RECKON_S);
  if (!moves || dt <= 0) return { lng: r.lng, lat: r.lat, altM, t: seenMs };
  const [lng, lat] = destination([r.lng, r.lat], r.trackDeg!, (r.gsKt! * KT_TO_KMH * dt) / 3600);
  return { lng, lat, altM, t: seenMs + dt * 1000 };
}

function vertices(track: readonly TrackPoint[], head: Vertex | null): Vertex[] {
  const out: Vertex[] = [];
  let last = -Infinity;
  for (const p of track) {
    const t = Date.parse(p.t);
    // Out-of-order or undated samples cannot be placed on the time axis: skip, never re-date.
    if (!Number.isFinite(t) || t < last) continue;
    out.push({ lng: p.lng, lat: p.lat, altM: p.onGround ? 0 : Math.max(0, p.altFt ?? 0) * FT_TO_M, t });
    last = t;
  }
  // A trace sample newer than the snapshot already is the newest observation: no head after it.
  if (head && head.t > last) out.push(head);
  return out;
}

/** Split one run at ±180° (unwrapping first), interpolating the crossing latitude and time. */
function splitRun(run: Vertex[], emit: (path: [number, number][], ts: number[]) => void): void {
  let path: [number, number][] = [[run[0]!.lng, run[0]!.lat]];
  let ts: number[] = [run[0]!.t];
  let prevLng = run[0]!.lng;
  for (let i = 1; i < run.length; i++) {
    const a = run[i - 1]!;
    const b = run[i]!;
    let d = b.lng - prevLng;
    if (d > 180) d -= 360;
    else if (d < -180) d += 360;
    const unwrapped = prevLng + d;
    if (unwrapped > 180 || unwrapped < -180) {
      const edge = unwrapped > 180 ? 180 : -180;
      const f = (edge - prevLng) / (unwrapped - prevLng);
      const lat = a.lat + f * (b.lat - a.lat);
      const t = a.t + f * (b.t - a.t);
      path.push([edge, lat]);
      ts.push(t);
      emit(path, ts);
      path = [[-edge, lat]];
      ts = [t];
    }
    path.push([b.lng, b.lat]);
    ts.push(b.t);
    prevLng = b.lng;
  }
  emit(path, ts);
}

/**
 * Trips for the watched aircraft. `liveOf(hex)` returns the aircraft's record in the current
 * snapshot (undefined when it is not in it: the trail then ends at its last observed sample).
 * `camera: null` (mercator) keeps every vertex. Returns null when nothing is drawable.
 */
export function buildTrips(
  watched: readonly string[],
  tracks: ReadonlyMap<string, readonly TrackPoint[]>,
  liveOf: (hex: string) => FlightRecord | undefined,
  nowMs: number,
  camera: FarSideCamera | null,
): TripSet | null {
  const raw: { hex: string; path: [number, number][]; ts: number[] }[] = [];
  let head = -Infinity;
  let base = Infinity;
  for (const hex of watched) {
    const track = tracks.get(hex);
    if (!track?.length) continue;
    const live = liveOf(hex);
    const vs = vertices(track, live ? headOf(live, nowMs) : null);
    if (vs.length < 2) continue;
    head = Math.max(head, vs[vs.length - 1]!.t);
    let run: Vertex[] = [];
    const flush = () => {
      if (run.length >= 2)
        splitRun(run, (path, ts) => {
          if (path.length < 2) return;
          raw.push({ hex, path, ts });
          base = Math.min(base, ts[0]!);
        });
      run = [];
    };
    for (const v of vs) {
      if (isFacing([v.lng, v.lat], camera, v.altM)) run.push(v);
      else flush();
    }
    flush();
  }
  if (!raw.length) return null;
  return {
    baseMs: base,
    currentTime: (head - base) / 1000,
    trips: raw.map(({ hex, path, ts }) => ({ hex, path, timestamps: ts.map((t) => (t - base) / 1000) })),
  };
}
