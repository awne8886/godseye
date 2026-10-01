/**
 * Loads the bundled planner data (public/data/*, produced by tools/build-airports.ts and
 * tools/build-routes.ts) once per process and builds the in-memory lookups:
 *  - airports by IATA / ICAO / gps_code / ident (default index, then the full airfield index)
 *  - VRS routes: callsign → airport chain, ordered airport pair → callsigns (multi-stop aware)
 *  - OpenFlights (2014) historical pair → services and airline designators
 * Server-only.
 */
import 'server-only';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { z } from 'zod';
import type { Airport as AirportSchema } from '@/lib/schemas/flight-paths';
import { AIRPORT_TYPES, type AirportIndexFile, type AirportRow, type OpenFlightsFile, type RunwayIndexFile, type VrsRoutesFile } from '../lib/data-format';

export type Airport = z.infer<typeof AirportSchema>;

export interface AirportRecord extends Airport {
  gps: string | null;
  keywords: string | null;
  longestRunwayM: number | null;
}

export const DATA_DIR = path.join(process.cwd(), 'public', 'data');

function readData<T>(file: string): T {
  const buf = readFileSync(path.join(DATA_DIR, file));
  return JSON.parse((file.endsWith('.gz') ? gunzipSync(buf) : buf).toString('utf8')) as T;
}

/** Build time of a bundled file (for `age_s` in providers). */
export function dataFileMtime(file: string): number | null {
  try {
    return statSync(path.join(DATA_DIR, file)).mtimeMs;
  } catch {
    return null;
  }
}

export function toRecord(r: AirportRow, countries: Record<string, string>, regions: Record<string, string>): AirportRecord {
  const [ident, icao, iata, gps, name, type, lat, lng, elevationFt, municipality, isoCountry, isoRegion, scheduled, tz, keywords, longestRunwayM] = r;
  return {
    ident,
    icao,
    iata,
    name,
    type: AIRPORT_TYPES[type] ?? 'small_airport',
    lat,
    lng,
    elevationFt,
    municipality,
    isoCountry,
    country: countries[isoCountry] ?? null,
    isoRegion,
    region: isoRegion ? (regions[isoRegion] ?? null) : null,
    scheduledService: scheduled === 1,
    tz,
    gps,
    keywords,
    longestRunwayM,
  };
}

export interface AirportIndex {
  kind: 'min' | 'all';
  generatedAt: string;
  sources: Record<string, string | null>;
  list: AirportRecord[];
  byIata: Map<string, AirportRecord>;
  byIcao: Map<string, AirportRecord>;
  byIdent: Map<string, AirportRecord>;
}

const rank = (a: AirportRecord) => (a.type === 'large_airport' ? 3 : a.type === 'medium_airport' ? 2 : 1) + (a.scheduledService ? 3 : 0);

export function buildIndex(file: AirportIndexFile, kind: 'min' | 'all'): AirportIndex {
  const list = file.rows.map((r) => toRecord(r, file.countries, file.regions));
  const byIata = new Map<string, AirportRecord>();
  const byIcao = new Map<string, AirportRecord>();
  const byIdent = new Map<string, AirportRecord>();
  const put = (m: Map<string, AirportRecord>, k: string | null, a: AirportRecord) => {
    if (!k) return;
    const cur = m.get(k);
    if (!cur || rank(a) > rank(cur)) m.set(k, a);
  };
  for (const a of list) {
    put(byIata, a.iata, a);
    put(byIcao, a.icao, a);
    put(byIdent, a.ident.toUpperCase(), a);
    put(byIdent, a.gps, a);
  }
  return { kind, generatedAt: file.generatedAt, sources: file.sources, list, byIata, byIcao, byIdent };
}

interface Loaded {
  min?: AirportIndex;
  all?: AirportIndex;
  runways?: RunwayIndexFile;
  vrs?: VrsIndex;
  openflights?: OpenFlightsFile;
  services?: Map<string, number>;
}

const G = globalThis as unknown as { __godseyeFlightPaths?: Loaded };
const loaded: Loaded = (G.__godseyeFlightPaths ??= {});

export function airportIndex(kind: 'min' | 'all' = 'min'): AirportIndex {
  if (kind === 'min') return (loaded.min ??= buildIndex(readData<AirportIndexFile>('airports.min.json'), 'min'));
  return (loaded.all ??= buildIndex(readData<AirportIndexFile>('airports-all.json.gz'), 'all'));
}

export function runwayIndex(): RunwayIndexFile {
  return (loaded.runways ??= readData<RunwayIndexFile>('airports-runways.json.gz'));
}

/** Resolve an IATA / ICAO / gps_code / ident, default index first, then every airfield. */
export function findAirport(code: string): AirportRecord | null {
  const c = code.trim().toUpperCase();
  if (!c) return null;
  for (const kind of ['min', 'all'] as const) {
    const idx = airportIndex(kind);
    const hit = (c.length === 3 ? idx.byIata.get(c) : undefined) ?? (c.length === 4 ? idx.byIcao.get(c) : undefined) ?? idx.byIdent.get(c) ?? idx.byIata.get(c) ?? idx.byIcao.get(c);
    if (hit) return hit;
  }
  return null;
}

// ── VRS routes ──────────────────────────────────────────────────────────────────
export interface VrsIndex {
  generatedAt: string;
  lastModified: string | null;
  chainOf: Map<string, string[]>;
  /** `ORIG-DEST` (ICAO, in flight order, any stops between) → callsigns. */
  byPair: Map<string, string[]>;
  size: number;
}

export function buildVrsIndex(file: VrsRoutesFile): VrsIndex {
  const chainOf = new Map<string, string[]>();
  const byPair = new Map<string, string[]>();
  let size = 0;
  for (const [key, callsigns] of Object.entries(file.chains)) {
    const chain = key.split('-');
    for (const cs of callsigns) chainOf.set(cs, chain);
    size += callsigns.length;
    const seen = new Set<string>();
    for (let i = 0; i < chain.length - 1; i++) {
      for (let j = i + 1; j < chain.length; j++) {
        const pair = `${chain[i]}-${chain[j]}`;
        if (chain[i] === chain[j] || seen.has(pair)) continue;
        seen.add(pair);
        const list = byPair.get(pair);
        if (list) list.push(...callsigns);
        else byPair.set(pair, [...callsigns]);
      }
    }
  }
  return { generatedAt: file.generatedAt, lastModified: file.lastModified, chainOf, byPair, size };
}

export function vrsIndex(): VrsIndex {
  return (loaded.vrs ??= buildVrsIndex(readData<VrsRoutesFile>('routes-vrs.json.gz')));
}

/**
 * VRS standing-data services (callsigns) that call at an airport (ICAO), as a measure of scheduled
 * traffic: it tells a city's main airport from a namesake with the same OurAirports class
 * (Santiago: SCL ≫ SCU/STI/SCQ). Built once from the VRS index on first use.
 */
export function servicesAt(icao: string | null): number {
  if (!icao) return 0;
  if (!loaded.services) {
    // Callsigns of one VRS route share its chain array: count per chain, then per airport.
    const perChain = new Map<readonly string[], number>();
    for (const chain of vrsIndex().chainOf.values()) perChain.set(chain, (perChain.get(chain) ?? 0) + 1);
    const counts = new Map<string, number>();
    for (const [chain, n] of perChain) for (const c of new Set(chain)) counts.set(c, (counts.get(c) ?? 0) + n);
    loaded.services = counts;
  }
  return loaded.services.get(icao) ?? 0;
}

export function openFlights(): OpenFlightsFile {
  return (loaded.openflights ??= readData<OpenFlightsFile>('routes-openflights.json.gz'));
}

/** Test hook: drop the loaded data so a test can inject its own. */
export function injectData(d: Partial<Loaded>): void {
  Object.assign(loaded, d);
}
