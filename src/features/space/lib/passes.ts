/**
 * Next visible pass of a satellite over one ground point (the map centre the user chose; never the
 * visitor's own location). PREDICTED with SGP4 from published elements, not observed. The search
 * steps through time and reports times to the step's precision. Pure. Owner: layers-space.
 */
import { degreesToRadians, ecfToLookAngles, eciToEcf, gstime, propagate, type SatRec } from 'satellite.js';

export interface Pass {
  /** Epoch ms of the first sample above the elevation mask (it rose within the preceding step). */
  aosMs: number;
  /** Epoch ms of the highest sample. */
  maxMs: number;
  maxElevationDeg: number;
  /** Azimuth (degrees from north, clockwise) at AOS. */
  aosAzimuthDeg: number;
  /** Epoch ms of the last sample above the mask; null when the pass outlasts the search window. */
  losMs: number | null;
}

export type PassResult =
  | { kind: 'pass'; pass: Pass; inProgress: boolean }
  | { kind: 'always-up' }
  | { kind: 'none' }
  | { kind: 'unpropagatable' };

export interface PassOptions {
  minElevationDeg?: number;
  windowMinutes?: number;
  stepSeconds?: number;
}

const RAD_TO_DEG = 180 / Math.PI;

/** Elevation/azimuth (degrees) of the satellite from `observer` at `ms`; null if SGP4 fails. */
export function lookAt(satrec: SatRec, observer: { lat: number; lng: number; heightKm?: number }, ms: number): { el: number; az: number } | null {
  const at = new Date(ms);
  let pv;
  try {
    pv = propagate(satrec, at, { communityDecayCheckEnabled: true });
  } catch {
    return null;
  }
  if (!pv || typeof pv.position !== 'object') return null;
  const ecf = eciToEcf(pv.position, gstime(at));
  const look = ecfToLookAngles({ latitude: degreesToRadians(observer.lat), longitude: degreesToRadians(observer.lng), height: observer.heightKm ?? 0 }, ecf);
  const el = look.elevation * RAD_TO_DEG;
  const az = ((look.azimuth * RAD_TO_DEG) % 360 + 360) % 360;
  return Number.isFinite(el) && Number.isFinite(az) ? { el, az } : null;
}

/**
 * The first pass above `minElevationDeg` (default 10°) starting at or after `fromMs`, within
 * `windowMinutes` (default 24 h), sampled every `stepSeconds` (default 30 s). A satellite already
 * above the mask at `fromMs` reports that pass (`inProgress`); one that never sets in the window is
 * `always-up` (geostationary seen from below); a failed propagation is `unpropagatable`.
 */
export function nextPass(satrec: SatRec, observer: { lat: number; lng: number }, fromMs: number, opts: PassOptions = {}): PassResult {
  const mask = opts.minElevationDeg ?? 10;
  const stepMs = (opts.stepSeconds ?? 30) * 1000;
  const endMs = fromMs + (opts.windowMinutes ?? 24 * 60) * 60_000;
  let pass: Pass | null = null;
  let inProgress = false;
  let sampled = 0;
  for (let t = fromMs; t <= endMs; t += stepMs) {
    const look = lookAt(satrec, observer, t);
    if (!look) continue;
    sampled++;
    const up = look.el >= mask;
    if (!pass) {
      if (!up) continue;
      inProgress = t === fromMs;
      pass = { aosMs: t, maxMs: t, maxElevationDeg: look.el, aosAzimuthDeg: look.az, losMs: t };
      continue;
    }
    if (!up) {
      return { kind: 'pass', pass, inProgress };
    }
    pass.losMs = t;
    if (look.el > pass.maxElevationDeg) {
      pass.maxElevationDeg = look.el;
      pass.maxMs = t;
    }
  }
  if (sampled === 0) return { kind: 'unpropagatable' };
  if (!pass) return { kind: 'none' };
  // Above the mask from the first sample to the last: it never set in the window.
  if (inProgress) return { kind: 'always-up' };
  return { kind: 'pass', pass: { ...pass, losMs: null }, inProgress };
}
