/**
 * Aviation contracts. Owner: layers-aviation (may add optional fields; never rename/remove).
 * Altitudes are FEET (barometric unless named geom), speeds KNOTS, vertical rate FEET/MIN,
 * headings/tracks DEGREES TRUE [0, 360). OSIRIS mixed metres and feet; GODSEYE does not.
 */
import { z } from 'zod';
import { EntityBase, Envelope, IsoTime, Lat, Lng, columnarResponse } from './common';

/** OSIRIS's four rail buckets, classified with its exact rules (docs/reference/03 §1). */
export const AircraftBucket = z.enum(['commercial', 'private', 'jet', 'military']);

export const Aircraft = EntityBase.extend({
  /** ICAO 24-bit address, lowercase hex (6 chars; `~` prefix for non-ICAO/TIS-B). */
  id: z.string().regex(/^~?[0-9a-f]{6}$/),
  /** Trimmed, upper-case (adsb.lol pads `flight` with spaces: trim before matching VRS routes). */
  callsign: z.string().regex(/^[A-Z0-9]{2,8}$/).nullable(),
  registration: z.string().nullable(),
  /** ICAO type designator, e.g. `B77W`. */
  typeCode: z.string().nullable(),
  bucket: AircraftBucket,
  isHelicopter: z.boolean(),
  onGround: z.boolean(),
  /** Barometric altitude in feet; null if not reported. */
  altFt: z.number().nullable(),
  altGeomFt: z.number().nullable(),
  gsKt: z.number().nonnegative().nullable(),
  trackDeg: z.number().min(0).lt(360).nullable(),
  vrFpm: z.number().nullable(),
  squawk: z.string().regex(/^[0-7]{4}$/).nullable(),
  /** 7500 hijack, 7600 radio failure, 7700 general emergency. */
  emergency: z.enum(['7500', '7600', '7700']).nullable(),
  /** ADS-B emitter category, e.g. `A3`. */
  category: z.string().nullable(),
  /** Navigation accuracy category for position (used for GPS-interference binning). */
  nacP: z.number().int().min(0).max(11).nullable(),
  /** readsb dbFlags bitfield (1 = military, 2 = interesting, 4 = PIA, 8 = LADD). */
  dbFlags: z.number().int().nonnegative().nullable(),
  /** 3-letter ICAO airline designator parsed from the callsign, e.g. `BAW`. */
  airlineCode: z.string().length(3).nullable(),
  /** ADS-B emergency/priority status as broadcast (distinct from the squawk code). */
  emergencyStatus: z.enum(['general', 'lifeguard', 'minfuel', 'nordo', 'unlawful', 'downed', 'reserved']).nullable().optional(),
  /** Position source: MLAT and TIS-B positions are less precise than ADS-B; the card says so. */
  posSource: z.enum(['adsb', 'mlat', 'tisb', 'adsr', 'other']).nullable().optional(),
});

/**
 * Columnar row layout of GET /api/flights. Compact cells keep 24k+ aircraft under the 4 MB cap:
 * `bucket` = index into AircraftBucket.options, `isHelicopter`/`onGround` = 0|1, `seenAt` = epoch
 * SECONDS of the position, `src` = index into the response's `sources`, lat/lng rounded to 5 dp,
 * speeds/tracks to 1 dp. The airline code is derived client-side from the callsign.
 */
export const FLIGHT_FIELDS = [
  'id',
  'callsign',
  'registration',
  'typeCode',
  'bucket',
  'isHelicopter',
  'onGround',
  'lat',
  'lng',
  'altFt',
  'altGeomFt',
  'gsKt',
  'trackDeg',
  'vrFpm',
  'squawk',
  'category',
  'nacP',
  'dbFlags',
  'seenAt',
  'src',
] as const;

export const FlightsResponse = columnarResponse(FLIGHT_FIELDS, 40_000).extend({
  /** Provider names referenced by the `src` column. */
  sources: z.array(z.string()),
  counts: z.object({
    commercial: z.number().int().nonnegative(),
    private: z.number().int().nonnegative(),
    jet: z.number().int().nonnegative(),
    military: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    /** Aircraft reported by upstreams without a position (e.g. /v2/mil, /v2/ladd rows); not drawn. */
    noPosition: z.number().int().nonnegative(),
  }),
});

/** A point of a flown track (readsb trace row), newest last. */
export const TrackPoint = z.object({
  t: IsoTime,
  lat: Lat,
  lng: Lng,
  /** null when the aircraft reported `ground`. */
  altFt: z.number().nullable(),
  onGround: z.boolean(),
  gsKt: z.number().nullable(),
  trackDeg: z.number().min(0).lt(360).nullable(),
});

export const AircraftIdentity = z.object({
  hex: z.string(),
  registration: z.string().nullable(),
  typeCode: z.string().nullable(),
  model: z.string().nullable(),
  manufacturer: z.string().nullable(),
  operator: z.string().nullable(),
  operatorIcao: z.string().nullable(),
  country: z.string().nullable(),
  photoUrl: z.url().nullable(),
  photoThumbUrl: z.url().nullable(),
  /** adsbdb supplies no photographer credit; show the photo host instead. */
  photoCredit: z.string().nullable(),
});

/** GET /api/aircraft?icao24= */
export const AircraftDetailResponse = Envelope.extend({
  hex: z.string(),
  identity: AircraftIdentity.nullable(),
  /** Current leg only (split on ≥4 consecutive ground samples), downsampled to ≤700 points keeping endpoints. */
  track: z.array(TrackPoint),
  trackSource: z.string().nullable(),
});

/** Airport reference embedded in route lookups. */
export const RouteAirport = z.object({
  icao: z.string().nullable(),
  iata: z.string().nullable(),
  name: z.string(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  lat: Lat,
  lng: Lng,
});

/** GET /api/flight-route?callsign=&icao24=&lat=&lng=&speed= */
export const FlightRouteResponse = z.object({
  callsign: z.string(),
  found: z.boolean(),
  origin: RouteAirport.nullable(),
  destination: RouteAirport.nullable(),
  /** `observed` = departure corroborated from the flown track; `schedule` = standing data only. */
  basis: z.enum(['observed', 'schedule', 'corridor']).nullable(),
  status: z.enum(['scheduled', 'airborne', 'landed', 'unknown']),
  /** 0..1 along the great circle, only when airborne and on-corridor. */
  progress: z.number().min(0).max(1).nullable(),
  distanceKm: z.number().nonnegative().nullable(),
  source: z.string().nullable(),
  /** When the route source last updated this callsign's record (VRS file date, hexdb `updatetime`). */
  sourceUpdatedAt: IsoTime.nullable().optional(),
  /** True when the only answer is an old record (hexdb fallback older than 180 days): shown as STALE. */
  stale: z.boolean().optional(),
  /**
   * True when a source listed a route for this callsign but the aircraft is more than 1.5 × the
   * route length from both endpoints (OSIRIS plausibility rule): `found` is false, no FROM/TO shown.
   */
  implausible: z.boolean().optional(),
  providers: Envelope.shape.providers,
  timestamp: IsoTime,
});
