/**
 * OSINT, geocoding, directions and ArcGIS contracts. Owner: panels-recon.
 * Lookups are passive and about infrastructure (domains, IPs, ASNs, CVEs, wallets), never people.
 */
import { z } from 'zod';
import { IsoTime, Lat, Lng, Providers } from './common';

export const OsintTool = z.enum([
  'dns', 'whois', 'headers', 'certs', 'ip', 'bgp', 'shodan', 'sweep', 'mac', 'cve', 'threats', 'sanctions', 'crypto', 'leaks', 'scanner',
]);

/** Generic envelope for every /api/osint/* tool; `data` is tool-specific and documented in /docs. */
export const OsintResponse = z.object({
  tool: OsintTool,
  query: z.string(),
  data: z.record(z.string(), z.unknown()),
  /** Transparent reasoning for any grade/risk shown (e.g. which headers are missing). */
  findings: z.array(z.object({ level: z.enum(['info', 'low', 'medium', 'high', 'critical']), label: z.string(), detail: z.string() })),
  providers: Providers,
  timestamp: IsoTime,
});

export const Place = z.object({
  name: z.string(),
  label: z.string(),
  lat: Lat,
  lng: Lng,
  kind: z.string(),
  countryCode: z.string().nullable(),
  bbox: z.tuple([Lng, Lat, Lng, Lat]).nullable(),
  source: z.enum(['photon', 'nominatim', 'coordinates', 'ip']),
});

/** /api/geo, /api/geo/reverse, /api/geosearch */
export const GeoResponse = z.object({
  results: z.array(Place),
  attribution: z.string(),
  providers: Providers,
  timestamp: IsoTime,
});

export const DirectionsResponse = z.object({
  engine: z.enum(['valhalla', 'osrm']),
  mode: z.enum(['drive', 'walk', 'bike']),
  distanceM: z.number().nonnegative(),
  durationS: z.number().nonnegative(),
  geometry: z.custom<GeoJSON.LineString>(),
  steps: z.array(z.object({ instruction: z.string(), distanceM: z.number(), durationS: z.number(), maneuver: z.string().nullable(), startIndex: z.number().int() })),
  elevation: z.array(z.object({ distanceM: z.number(), elevationM: z.number() })).nullable(),
  alternates: z.array(z.custom<GeoJSON.LineString>()),
  attribution: z.string(),
  providers: Providers,
  timestamp: IsoTime,
});

export const ArcgisResponse = z.object({
  mode: z.enum(['search', 'layer']),
  items: z.array(z.object({ id: z.string(), title: z.string(), owner: z.string().nullable(), url: z.url(), snippet: z.string().nullable(), extent: z.tuple([Lng, Lat, Lng, Lat]).nullable() })),
  features: z.custom<GeoJSON.FeatureCollection>().nullable(),
  truncated: z.boolean(),
  providers: Providers,
  timestamp: IsoTime,
});
