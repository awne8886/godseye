/**
 * Bundled Flight Path Planner data files (written by tools/build-airports.ts and
 * tools/build-routes.ts into public/data/, read server-side by server/data.ts). Columnar rows keep
 * the files small; the field order below is the contract between the tools and the server.
 * Isomorphic, no I/O. Owner: feature-flight-paths.
 */

export const AIRPORT_TYPES = ['large_airport', 'medium_airport', 'small_airport', 'heliport', 'seaplane_base', 'closed', 'balloonport'] as const;
export type AirportTypeName = (typeof AIRPORT_TYPES)[number];

/** Tuple slots of one airport row. */
export const AIRPORT_FIELDS = [
  'ident',
  'icao',
  'iata',
  'gps',
  'name',
  'type',
  'lat',
  'lng',
  'elevationFt',
  'municipality',
  'isoCountry',
  'isoRegion',
  'scheduled',
  'tz',
  'keywords',
  'longestRunwayM',
] as const;

export type AirportRow = [
  ident: string,
  icao: string | null,
  iata: string | null,
  gps: string | null,
  name: string,
  /** Index into AIRPORT_TYPES. */
  type: number,
  lat: number,
  lng: number,
  elevationFt: number | null,
  municipality: string | null,
  isoCountry: string,
  isoRegion: string | null,
  scheduled: 0 | 1,
  tz: string | null,
  keywords: string | null,
  /** Longest open, paved-or-unknown runway in metres (null when OurAirports lists none). */
  longestRunwayM: number | null,
];

export interface AirportIndexFile {
  version: 1;
  generatedAt: string;
  /** Upstream Last-Modified (or fetch time) per source file. */
  sources: Record<string, string | null>;
  fields: typeof AIRPORT_FIELDS;
  rows: AirportRow[];
  countries: Record<string, string>;
  regions: Record<string, string>;
}

/** `[leIdent, heIdent, lengthFt, widthFt, surface, lighted, closed]` */
export type RunwayRow = [string | null, string | null, number | null, number | null, string | null, 0 | 1, 0 | 1];

export interface RunwayIndexFile {
  version: 1;
  generatedAt: string;
  byIdent: Record<string, RunwayRow[]>;
}

/** VRS standing-data routes grouped by airport chain: `KJFK-EGLL` → callsigns. */
export interface VrsRoutesFile {
  version: 1;
  generatedAt: string;
  /** Upstream URL the index was built from (older builds lack it). */
  source?: string;
  /** Upstream Last-Modified (ISO) or null when unknown. */
  lastModified: string | null;
  licence: 'CC0-1.0';
  chains: Record<string, string[]>;
}

/** OpenFlights routes.dat (frozen June 2014): `SRC-DST` (as written, IATA or ICAO) → services. */
export type HistoricalRow = [airline: string, codeshare: 0 | 1, stops: number, equipment: string];

export interface OpenFlightsFile {
  version: 1;
  generatedAt: string;
  /** Upstream URLs the file was built from (older builds lack it). */
  source?: { routes: string; airlines: string };
  licence: 'ODbL-1.0';
  note: string;
  routes: Record<string, HistoricalRow[]>;
  /** Airline ICAO → [IATA, name, telephony callsign, country, active]. */
  airlines: Record<string, [string | null, string, string | null, string | null, 0 | 1]>;
}

/** Surfaces OurAirports lists for hard runways (asphalt/concrete variants). */
export function isPavedSurface(surface: string | null): boolean {
  if (!surface) return false;
  const s = surface.toUpperCase();
  return /ASP|CON|PEM|BIT|TAR|PAV|ASPH|CONC|BET/.test(s);
}

export const FT_TO_M = 0.3048;
