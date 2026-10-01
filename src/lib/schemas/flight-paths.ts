/**
 * Flight Path Planner contracts (§8). Owner: feature-flight-paths.
 * Response shapes follow the build prompt §8 field-for-field; units are explicit.
 */
import { z } from 'zod';
import { IsoTime, Lat, Lng, LngLat, LocalTime, Providers } from './common';
import { AircraftIdentity, TrackPoint } from './aviation';

export const AirportType = z.enum(['large_airport', 'medium_airport', 'small_airport', 'heliport', 'seaplane_base', 'closed', 'balloonport']);

export const Airport = z.object({
  /** OurAirports ident (usually ICAO or gps_code). */
  ident: z.string(),
  icao: z.string().nullable(),
  iata: z.string().nullable(),
  name: z.string(),
  type: AirportType,
  lat: Lat,
  lng: Lng,
  elevationFt: z.number().nullable(),
  municipality: z.string().nullable(),
  isoCountry: z.string().length(2),
  country: z.string().nullable(),
  isoRegion: z.string().nullable(),
  region: z.string().nullable(),
  scheduledService: z.boolean(),
  /** IANA time zone (mwgg/Airports). */
  tz: z.string().nullable(),
});

export const AirportMatch = Airport.extend({
  score: z.number(),
  matchedBy: z.enum(['iata', 'icao', 'ident', 'fuzzy', 'metro', 'photon', 'nominatim']),
});

/** GET /api/airports/search?q=&all=0|1 */
export const AirportSearchResponse = z.object({
  query: z.string(),
  results: z.array(AirportMatch),
  /** Metro group when the query names a multi-airport city (London → LHR/LGW/STN/LTN/LCY/SEN). */
  metro: z.object({ name: z.string(), codes: z.array(z.string()) }).nullable(),
  providers: Providers,
  timestamp: IsoTime,
});

export const FlightCategory = z.enum(['VFR', 'MVFR', 'IFR', 'LIFR']);

export const AirportWeather = z.object({
  metar: z.string().nullable(),
  taf: z.string().nullable(),
  fltCat: FlightCategory.nullable(),
  observedAt: IsoTime.nullable(),
  tempC: z.number().nullable(),
  windDirDeg: z.number().nullable(),
  windKt: z.number().nullable(),
  gustKt: z.number().nullable(),
  /** Visibility as reported (METAR JSON gives strings like "6+"). */
  visibility: z.string().nullable(),
  altimHpa: z.number().nullable(),
  clouds: z.array(z.object({ cover: z.string(), baseFt: z.number().nullable() })),
});

export const Runway = z.object({
  leIdent: z.string().nullable(),
  heIdent: z.string().nullable(),
  lengthFt: z.number().nullable(),
  widthFt: z.number().nullable(),
  surface: z.string().nullable(),
  lighted: z.boolean(),
  closed: z.boolean(),
});

/** GET /api/airports/{code} */
export const AirportDetailResponse = z.object({
  airport: Airport,
  runways: z.array(Runway),
  weather: AirportWeather,
  localTime: LocalTime.nullable(),
  providers: Providers,
  timestamp: IsoTime,
});

export const Daylight = z.object({
  fraction: z.number().min(0).max(1),
  isDay: z.boolean(),
  twilight: z.enum(['day', 'civil', 'nautical', 'astronomical', 'night']),
});

export const KnownService = z.object({
  callsign: z.string(),
  airline: z.object({ icao: z.string().nullable(), iata: z.string().nullable(), name: z.string().nullable() }),
  live: z.boolean(),
  source: z.literal('vrs'),
  /** Full airport chain for multi-stop services, e.g. ['KLAS','EGLL']. */
  airportCodes: z.array(z.string()),
});

export const BlockEstimate = z.object({ cruiseKts: z.number().positive(), blockMinutes: z.number().int().positive() });

export const Waypoint = z.object({
  ident: z.string(),
  type: z.string(),
  lat: Lat,
  lng: Lng,
  altFt: z.number().nullable(),
  via: z.string().nullable(),
});

export const DiversionAirport = z.object({
  code: z.string(),
  name: z.string(),
  runwayM: z.number().positive(),
  distanceFromPathKm: z.number().nonnegative(),
  alongPathKm: z.number().nonnegative(),
  /** Airport position (for the map layer). */
  lat: Lat.optional(),
  lng: Lng.optional(),
});

export const RouteEndpoint = Airport.pick({ ident: true, icao: true, iata: true, name: true, lat: true, lng: true, tz: true, municipality: true, isoCountry: true });

/** GET /api/route/plan?from=&to= */
export const RoutePlanResponse = z.object({
  origin: RouteEndpoint,
  destination: RouteEndpoint,
  greatCircle: z.object({
    /** ≥128 points; longitudes unwrapped by ±360 so the line is continuous in mercator and globe. */
    points: z.array(z.tuple([z.number(), Lat])).min(128),
    /** Same path split at the antimeridian for GeoJSON export. */
    multiLineString: z.custom<GeoJSON.MultiLineString>(),
    distanceKm: z.number().nonnegative(),
    distanceNm: z.number().nonnegative(),
    initialBearing: z.number().min(0).lt(360),
    finalBearing: z.number().min(0).lt(360),
    midpoint: LngLat,
    antimeridianCrossings: z.number().int().nonnegative(),
    polar: z.boolean(),
  }),
  estimates: z.object({
    byClass: z.object({ narrowbody: BlockEstimate, widebody: BlockEstimate, bizjet: BlockEstimate, turboprop: BlockEstimate }),
    method: z.string(),
  }),
  timezones: z.object({
    origin: z.object({ tz: z.string().nullable(), localNow: LocalTime.nullable() }),
    destination: z.object({ tz: z.string().nullable(), localNow: LocalTime.nullable() }),
    offsetHours: z.number().nullable(),
  }),
  daylight: z.array(Daylight).length(10),
  /** How the daylight samples were timed (departure now, widebody cruise). */
  daylightMethod: z.string().optional(),
  knownServices: z.array(KnownService),
  historicalRoutes: z.array(
    z.object({ airline: z.string(), codeshare: z.boolean(), stops: z.number().int().nonnegative(), equipment: z.array(z.string()) }),
  ),
  airways: z.array(z.object({ ident: z.string(), type: z.string(), geometry: z.custom<GeoJSON.LineString | GeoJSON.MultiLineString>() })).optional(),
  filedPlans: z
    .array(
      z.object({
        id: z.string(),
        waypoints: z.array(Waypoint),
        distanceNm: z.number().nullable(),
        source: z.string(),
        disclaimer: z.string(),
      }),
    )
    .optional(),
  weather: z.object({
    origin: AirportWeather,
    destination: AirportWeather,
    windsAloft: z.array(z.object({ fraction: z.number(), lat: Lat, lng: Lng, speedKt: z.number().nullable(), dirDeg: z.number().nullable(), level: z.literal('250hPa') })),
  }),
  diversionAirports: z.array(DiversionAirport),
  /** Selection rule for diversionAirports (runway length, distance from path, spacing). */
  diversionMethod: z.string().optional(),
  /** Which path types are present: FILED / TYPICAL / GREAT-CIRCLE ESTIMATE. */
  pathLabels: z.array(z.enum(['FILED', 'TYPICAL', 'GREAT-CIRCLE ESTIMATE'])),
  providers: Providers,
  timestamp: IsoTime,
});

export const LiveRouteAircraft = z.object({
  hex: z.string(),
  callsign: z.string().nullable(),
  lat: Lat,
  lng: Lng,
  altFt: z.number().nullable(),
  gsKt: z.number().nullable(),
  trackDeg: z.number().nullable(),
  direction: z.enum(['forward', 'reverse']),
  /** `matched` = callsign from the VRS reverse index; `inferred` = corridor test only. */
  basis: z.enum(['matched', 'inferred']),
  progress: z.number().min(0).max(1),
  remainingKm: z.number().nonnegative(),
  eta: IsoTime.nullable(),
  etaLocal: LocalTime.nullable(),
  /** IANA zone of the destination, for the zone abbreviation on the card. */
  etaTz: z.string().nullable(),
  observedAt: IsoTime,
});

/** GET /api/route/live?from=&to=&reverse=1 */
export const RouteLiveResponse = z.object({
  from: z.string(),
  to: z.string(),
  aircraft: z.array(LiveRouteAircraft),
  snapshotAt: IsoTime.nullable(),
  /**
   * Coverage of the snapshot the list was read from: adsb.lol tiles read successfully at least once
   * of all tiles. `complete: false` (e.g. the first sweep after a start) means aircraft on the pair
   * may be missing — an empty list is then not "none flying".
   */
  coverage: z.object({ tilesRead: z.number().int().min(0), tilesTotal: z.number().int().min(0), complete: z.boolean() }).optional(),
  providers: Providers,
  timestamp: IsoTime,
});

export const FlightLink = z.object({ label: z.enum(['FlightAware', 'ADS-B Exchange', 'RadarBox', 'Flightradar24']), url: z.url() });

/** GET /api/flight/{ident} — ICAO callsign, IATA flight number, registration or 6-hex. */
export const FlightDetailResponse = z.object({
  ident: z.string(),
  resolved: z.object({
    callsign: z.string().nullable(),
    iataFlight: z.string().nullable(),
    hex: z.string().nullable(),
    registration: z.string().nullable(),
  }),
  status: z.enum(['scheduled', 'airborne', 'landed', 'unknown']),
  origin: RouteEndpoint.nullable(),
  destination: RouteEndpoint.nullable(),
  plannedArc: z.array(z.tuple([z.number(), Lat])),
  flownTrack: z.array(TrackPoint),
  remainingLeg: z.array(z.tuple([z.number(), Lat])),
  position: z
    .object({ lat: Lat, lng: Lng, altFt: z.number().nullable(), gsKt: z.number().nullable(), trackDeg: z.number().nullable(), observedAt: IsoTime })
    .nullable(),
  progress: z.number().min(0).max(1).nullable(),
  eta: IsoTime.nullable(),
  /** ETA as destination-local wall-clock time with its UTC offset. */
  etaLocal: LocalTime.nullable().optional(),
  /** IANA zone of the destination. */
  etaTz: z.string().nullable().optional(),
  /** Where the origin/destination came from; hexdb records are years old and flagged stale. */
  routeSource: z.object({ name: z.string().nullable(), stale: z.boolean(), updatedAt: IsoTime.nullable() }).nullable().optional(),
  /**
   * Basis of origin → destination: `standing-data` (VRS/adsbdb/hexdb, as listed), `observed-reverse`
   * (the aircraft's observed departure and course are the listed route reversed; shown as flown),
   * null when no route is shown.
   */
  routeBasis: z.enum(['standing-data', 'observed-reverse']).nullable().optional(),
  /** Why the route is reversed, withheld, or shown without progress (plain text, from the corroboration). */
  routeCheck: z.string().nullable().optional(),
  identity: AircraftIdentity.nullable(),
  weather: z.object({ origin: AirportWeather.nullable(), destination: AirportWeather.nullable() }),
  links: z.array(FlightLink),
  sources: z.array(z.object({ name: z.string(), ok: z.boolean(), detail: z.string().optional() })),
  providers: Providers,
  timestamp: IsoTime,
});
