/**
 * METAR/TAF for route endpoints from aviationweather.gov (AWC Data API, US public domain, keyless).
 * One request per product for up to a few stations, cached 5 min per station set; values keep
 * their observation time. A `{error}` body inside a 200 is a failure, never "no weather".
 * Server-only.
 */
import 'server-only';
import { sourceCache } from '@/lib/cache';
import { runProvider, type ProviderRun } from '@/lib/feeds';
import { httpJson } from '@/lib/http';
import { providerBucket } from '@/lib/ratelimit';
import { assertAwcArray, emptyWeather, parseMetar, type AirportWeather, type AwcMetar, type AwcTaf } from '../lib/metar';

export const AWC_METAR = (ids: readonly string[]) => `https://aviationweather.gov/api/data/metar?ids=${ids.join(',')}&format=json`;
export const AWC_TAF = (ids: readonly string[]) => `https://aviationweather.gov/api/data/taf?ids=${ids.join(',')}&format=json`;
const TTL_MS = 5 * 60_000;
/** AWC asks for ≤ 100 requests/min; stay far below. */
const awcBucket = () => providerBucket('aviationweather.gov', 1, 3);

export interface WeatherDeps {
  metar: (ids: readonly string[]) => Promise<AwcMetar[]>;
  taf: (ids: readonly string[]) => Promise<AwcTaf[]>;
}

async function getAwc<T>(url: string, what: string): Promise<T[]> {
  const res = await httpJson<unknown>(url, { timeoutMs: 8_000, retries: 1, limiter: awcBucket() });
  return assertAwcArray<T>(res.status === 204 ? [] : res.data, what);
}

const defaultDeps: WeatherDeps = {
  metar: (ids) => getAwc<AwcMetar>(AWC_METAR(ids), 'metar'),
  taf: (ids) => getAwc<AwcTaf>(AWC_TAF(ids), 'taf'),
};

interface Stored {
  metars: AwcMetar[];
  tafs: AwcTaf[];
  providers: Record<string, ProviderRun>;
}

export interface StationWeather {
  byStation: Map<string, AirportWeather>;
  providers: Record<string, ProviderRun>;
}

/** AWC only knows ICAO-style station ids (4 alphanumerics). */
export const isStationId = (s: string | null | undefined): s is string => typeof s === 'string' && /^[A-Z0-9]{4}$/.test(s);

export async function stationWeather(stations: readonly (string | null)[], deps: WeatherDeps = defaultDeps): Promise<StationWeather> {
  const ids = [...new Set(stations.filter(isStationId))].sort();
  const byStation = new Map<string, AirportWeather>();
  if (!ids.length) return { byStation, providers: {} };
  const cache = sourceCache<Stored>(
    `fp:awc:${ids.join(',')}`,
    async () => {
      const [m, t] = await Promise.all([
        runProvider(() => deps.metar(ids), (r) => r.length, { allowEmpty: true }),
        runProvider(() => deps.taf(ids), (r) => r.length, { allowEmpty: true }),
      ]);
      if (!m.run.status.ok && !t.run.status.ok) throw new Error(m.run.status.error ?? 'awc_failed');
      return { data: { metars: m.result ?? [], tafs: t.result ?? [], providers: { awc_metar: m.run, awc_taf: t.run } } };
    },
    { ttlMs: TTL_MS, retryAfterErrorMs: 60_000, deadlineMs: 15_000, isEmpty: () => false },
  );
  const r = await cache.get();
  if (!r.data) {
    const run: ProviderRun = { status: { ok: false, count: 0, ms: 0, age_s: null, error: r.error ?? 'error' }, okAt: null };
    for (const id of ids) byStation.set(id, emptyWeather());
    return { byStation, providers: { awc_metar: run, awc_taf: run } };
  }
  for (const id of ids) {
    const metar = r.data.metars.find((x) => x.icaoId === id);
    const taf = r.data.tafs.find((x) => x.icaoId === id);
    byStation.set(id, parseMetar(metar, taf));
  }
  return { byStation, providers: r.data.providers };
}

/** The best AWC station id for an airport: ICAO code, else a 4-character gps_code/ident. */
export function stationFor(a: { icao: string | null; gps?: string | null; ident: string }): string | null {
  return [a.icao, a.gps ?? null, a.ident.toUpperCase()].find(isStationId) ?? null;
}
