/**
 * SGP4 propagation helpers (satellite.js 7.1, OMM JSON via `json2satrec`). Isomorphic and pure:
 * the worker, the orbit route and the ISS ground track share them so a track passes through its
 * marker. Positions are PROPAGATED from published elements, never observed. Owner: layers-space.
 */
import { degreesLat, degreesLong, eciToGeodetic, gstime, json2satrec, propagate, type SatRec } from 'satellite.js';
import type { Omm, OrbitClass } from '@/lib/types';

export interface PropagatedPoint {
  lat: number;
  lng: number;
  /** Height above the WGS84 ellipsoid (km). */
  altKm: number;
  /** Inertial speed (km/s). */
  velocityKmS: number;
  /** ECI position (km), for shadow tests. */
  eci: { x: number; y: number; z: number };
}

/** Longitude wrapped to [-180, 180). */
export function wrapLng(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}

/** Build a satrec; null when the elements are unusable (SGP4 reports an error code). */
export function satrecFromOmm(omm: Omm): SatRec | null {
  try {
    const s = json2satrec(omm as never);
    return s && !(s as { error?: number }).error ? s : null;
  } catch {
    return null;
  }
}

/** Below 80 km it has re-entered; above 60 000 km it is not an Earth orbit we draw. */
export const MIN_ALT_KM = 80;
export const MAX_ALT_KM = 60_000;

/**
 * Propagate one satrec to `at`. Returns null for decayed/failed propagations (a gap is better
 * than a fabricated point). `communityDecayCheckEnabled` drops long-decayed objects SGP4 would
 * otherwise place at nonsense positions.
 */
export function propagateAt(satrec: SatRec, at: Date): PropagatedPoint | null {
  let pv;
  try {
    pv = propagate(satrec, at, { communityDecayCheckEnabled: true });
  } catch {
    return null;
  }
  if (!pv || typeof pv.position !== 'object' || typeof pv.velocity !== 'object') return null;
  const g = eciToGeodetic(pv.position, gstime(at));
  const lat = degreesLat(g.latitude);
  const lng = wrapLng(degreesLong(g.longitude));
  const altKm = g.height;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(altKm)) return null;
  if (altKm < MIN_ALT_KM || altKm > MAX_ALT_KM) return null;
  const v = pv.velocity;
  return { lat, lng, altKm, velocityKmS: Math.hypot(v.x, v.y, v.z), eci: { x: pv.position.x, y: pv.position.y, z: pv.position.z } };
}

/** Orbital period in minutes from mean motion (rev/day). */
export function periodMinutes(meanMotionRevPerDay: number): number | null {
  return Number.isFinite(meanMotionRevPerDay) && meanMotionRevPerDay > 0 ? 1440 / meanMotionRevPerDay : null;
}

const MU = 398_600.4418; // km³/s²
const EARTH_EQ_RADIUS_KM = 6378.137;

/**
 * Orbit regime from the elements (not from the instantaneous altitude, which misfiles a Molniya
 * at perigee as LEO): HEO when eccentricity ≥ 0.25; otherwise by mean altitude — LEO < 2 000 km,
 * GEO when the period is within 1 % of a sidereal day, MEO in between, HEO above.
 */
export function orbitClass(meanMotionRevPerDay: number, eccentricity: number): OrbitClass {
  const nRadS = (meanMotionRevPerDay * 2 * Math.PI) / 86_400;
  const aKm = Math.cbrt(MU / (nRadS * nRadS));
  const meanAlt = aKm - EARTH_EQ_RADIUS_KM;
  const period = 1440 / meanMotionRevPerDay;
  if (eccentricity >= 0.25) return 'HEO';
  if (meanAlt < 2000) return 'LEO';
  if (Math.abs(period - 1436.07) / 1436.07 < 0.01) return 'GEO';
  if (meanAlt < 35_000) return 'MEO';
  return 'HEO';
}

export type TrackPoint = [lng: number, lat: number, altKm: number];

/**
 * Sample ±½ period around `anchor` (the satellite sits mid-track). Sampled in time so spacing is
 * even for any eccentricity and Earth's rotation shows as westward drift. Failed samples are
 * skipped, never interpolated.
 */
export function orbitTrack(satrec: SatRec, meanMotion: number, anchor: Date, steps = 180): TrackPoint[] {
  const period = periodMinutes(meanMotion);
  if (!period) return [];
  const from = anchor.getTime() - (period * 60_000) / 2;
  const out: TrackPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const p = propagateAt(satrec, new Date(from + (period * 60_000 * i) / steps));
    if (p) out.push([round(p.lng, 4), round(p.lat, 4), Math.round(p.altKm)]);
  }
  return out;
}

/** Ground track from `from` forward over `minutes` (ISS panel). */
export function groundTrack(satrec: SatRec, from: Date, minutes: number, stepS = 60): TrackPoint[] {
  const out: TrackPoint[] = [];
  for (let t = 0; t <= minutes * 60; t += stepS) {
    const p = propagateAt(satrec, new Date(from.getTime() + t * 1000));
    if (p) out.push([round(p.lng, 4), round(p.lat, 4), Math.round(p.altKm)]);
  }
  return out;
}

/**
 * Split a track wherever consecutive longitudes jump by more than 180° (an antimeridian crossing),
 * so no segment sweeps back across the world. Single-point runs are dropped; at most `maxSegments`.
 */
export function splitTrackAtAntimeridian(track: readonly TrackPoint[], maxSegments = 8): TrackPoint[][] {
  if (track.length === 0) return [];
  const runs: TrackPoint[][] = [];
  let run: TrackPoint[] = [track[0]!];
  for (let i = 1; i < track.length; i++) {
    const p = track[i]!;
    if (Math.abs(p[0] - run[run.length - 1]![0]) > 180) {
      runs.push(run);
      run = [];
    }
    run.push(p);
  }
  runs.push(run);
  return runs.filter((r) => r.length > 1).slice(0, maxSegments);
}

/**
 * The anchor time a caller asked for, or now. A `t` more than 7 days from now is ignored: SGP4
 * accuracy decays away from the epoch and a far-off anchor would quietly draw a wrong orbit.
 */
export function anchorTime(t: number | undefined, now = Date.now()): Date {
  if (t === undefined || !Number.isFinite(t) || t <= 0) return new Date(now);
  return Math.abs(t - now) > 7 * 86_400_000 ? new Date(now) : new Date(t);
}

function round(v: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}
