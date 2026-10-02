/**
 * aviationweather.gov (AWC Data API) METAR/TAF JSON → AirportWeather. Isomorphic, pure.
 * Upstream quirks (probed 2026-09-30):
 *  - `obsTime` is epoch SECONDS; 999999 is a missing-value sentinel in numeric fields → null.
 *  - `visib` is a string when reported as "6+" / "10+" (metres ≥ 9999 or ≥ 10 SM), else a number.
 *  - `altim` is hPa in the JSON (KJFK's A3006 arrives as 1018).
 *  - Over quota the API can answer HTTP 200 with `{"error": …}` in the body: that is a failure.
 * Owner: feature-flight-paths.
 */
import type { z } from 'zod';
import type { AirportWeather as AirportWeatherSchema, FlightCategory } from '@/lib/schemas/flight-paths';

export type AirportWeather = z.infer<typeof AirportWeatherSchema>;
type FltCat = z.infer<typeof FlightCategory>;

export interface AwcMetar {
  icaoId?: string;
  obsTime?: number;
  temp?: number | null;
  wdir?: number | string | null;
  wspd?: number | null;
  wgst?: number | null;
  visib?: number | string | null;
  altim?: number | null;
  rawOb?: string;
  fltCat?: string | null;
  clouds?: { cover?: string; base?: number | null }[];
}

export interface AwcTaf {
  icaoId?: string;
  rawTAF?: string;
}

export class UpstreamBodyError extends Error {
  constructor(readonly detail: string) {
    super(detail);
  }
}

const SENTINEL = 999999;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v !== SENTINEL && v !== -SENTINEL ? v : null);
const FLT: readonly FltCat[] = ['VFR', 'MVFR', 'IFR', 'LIFR'];

/** Throw when a 200 answer carries an error object instead of the expected array. */
export function assertAwcArray<T>(body: unknown, what: string): T[] {
  if (Array.isArray(body)) return body as T[];
  if (body && typeof body === 'object' && 'error' in body) {
    const e = (body as { error: unknown }).error;
    throw new UpstreamBodyError(`${what}: ${typeof e === 'object' && e && 'code' in e ? `error ${(e as { code: unknown }).code}` : String(e)}`);
  }
  if (body === null || body === undefined || body === '') return []; // AWC answers 204/empty for "no reports"
  throw new UpstreamBodyError(`${what}: unexpected body`);
}

export function visibilityText(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null;
  const n = num(v);
  return n === null ? null : String(n);
}

/**
 * Flight category from ceiling (lowest BKN/OVC/VV base, ft) and visibility (statute miles):
 * LIFR < 500 ft or < 1 SM; IFR < 1,000 ft or < 3 SM; MVFR ≤ 3,000 ft or ≤ 5 SM; else VFR.
 * Used only when AWC did not supply `fltCat`.
 */
export function flightCategory(ceilingFt: number | null, visSm: number | null): FltCat | null {
  if (ceilingFt === null && visSm === null) return null;
  const c = ceilingFt ?? Infinity;
  const v = visSm ?? Infinity;
  if (c < 500 || v < 1) return 'LIFR';
  if (c < 1000 || v < 3) return 'IFR';
  if (c <= 3000 || v <= 5) return 'MVFR';
  return 'VFR';
}

function visSm(v: unknown): number | null {
  if (typeof v === 'string') {
    const m = /^(\d+(?:\.\d+)?)\+?$/.exec(v.trim());
    return m ? Number(m[1]) : null;
  }
  return num(v);
}

export function emptyWeather(): AirportWeather {
  return { metar: null, taf: null, fltCat: null, observedAt: null, tempC: null, windDirDeg: null, windKt: null, gustKt: null, visibility: null, altimHpa: null, clouds: [] };
}

export function parseMetar(m: AwcMetar | undefined, taf: AwcTaf | undefined): AirportWeather {
  const out = emptyWeather();
  out.taf = taf?.rawTAF?.trim() || null;
  if (!m) return out;
  const obs = num(m.obsTime);
  const clouds = (m.clouds ?? [])
    .filter((c) => typeof c.cover === 'string' && c.cover)
    .map((c) => ({ cover: c.cover!, baseFt: num(c.base) }));
  const ceiling = clouds.filter((c) => /^(BKN|OVC|OVX|VV)$/.test(c.cover) && c.baseFt !== null).reduce<number | null>((lo, c) => (lo === null || c.baseFt! < lo ? c.baseFt! : lo), null);
  const cat = typeof m.fltCat === 'string' && (FLT as readonly string[]).includes(m.fltCat) ? (m.fltCat as FltCat) : flightCategory(ceiling, visSm(m.visib));
  return {
    ...out,
    metar: m.rawOb?.trim() || null,
    fltCat: cat,
    observedAt: obs !== null && obs > 0 ? new Date(obs * 1000).toISOString() : null,
    tempC: num(m.temp),
    // "VRB" winds have no direction.
    windDirDeg: num(typeof m.wdir === 'string' ? Number.NaN : m.wdir),
    windKt: num(m.wspd),
    gustKt: num(m.wgst),
    visibility: visibilityText(m.visib),
    altimHpa: num(m.altim),
    clouds,
  };
}
