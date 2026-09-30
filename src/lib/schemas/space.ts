/**
 * Space contracts. Owner: layers-space.
 * CelesTrak ran out of 5-digit catalog numbers on 2026-07-11: satellites are ingested as
 * OMM JSON (`FORMAT=json`) and propagated client-side with satellite.js `json2satrec`.
 * NORAD ids are therefore plain integers that may exceed 99999.
 */
import { z } from 'zod';
import { Envelope, IsoTime, Lat, Lng, Providers, columnarResponse } from './common';

export const SatCategory = z.enum(['comms', 'military', 'navigation', 'earth_obs', 'science', 'other']);

/** Subset of CCSDS OMM fields required by `json2satrec` (names as CelesTrak emits them). */
export const Omm = z.object({
  OBJECT_NAME: z.string(),
  OBJECT_ID: z.string(),
  EPOCH: z.string(),
  MEAN_MOTION: z.number(),
  ECCENTRICITY: z.number(),
  INCLINATION: z.number(),
  RA_OF_ASC_NODE: z.number(),
  ARG_OF_PERICENTER: z.number(),
  MEAN_ANOMALY: z.number(),
  EPHEMERIS_TYPE: z.number().int(),
  CLASSIFICATION_TYPE: z.string(),
  NORAD_CAT_ID: z.number().int().positive(),
  ELEMENT_SET_NO: z.number().int(),
  REV_AT_EPOCH: z.number().int(),
  BSTAR: z.number(),
  MEAN_MOTION_DOT: z.number(),
  MEAN_MOTION_DDOT: z.number(),
});

/** Columnar layout of GET /api/satellites (OMM elements + GODSEYE classification). */
export const SATELLITE_FIELDS = [
  'noradId',
  'name',
  'objectId',
  'epoch',
  'meanMotion',
  'eccentricity',
  'inclination',
  'raan',
  'argOfPericenter',
  'meanAnomaly',
  'bstar',
  'meanMotionDot',
  'meanMotionDdot',
  'elementSetNo',
  'revAtEpoch',
  'category',
  'missionIndex',
  'group',
] as const;

export const Mission = z.object({
  name: z.string(),
  /** Hex colour from OSIRIS's MISSION_CLASSIFY palette. */
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  category: SatCategory,
});

/** GET /api/satellites?category= — OMM catalogue; `missionIndex` indexes `missions`. */
export const SatellitesResponse = columnarResponse(SATELLITE_FIELDS).extend({
  missions: z.array(Mission),
  categoryCounts: z.record(SatCategory, z.number().int().nonnegative()),
  /** Where the elements came from: CelesTrak OMM, or the labelled SatNOGS TLE fallback. (layers-space) */
  catalogueSource: z.enum(['celestrak', 'satnogs-fallback']).optional(),
  /** Human note shown with the layer (e.g. why the fallback is in use). (layers-space) */
  note: z.string().optional(),
});

/** Position computed by the propagation worker (never sent by the server). */
export const SatellitePosition = z.object({
  noradId: z.number().int(),
  lat: Lat,
  lng: Lng,
  altKm: z.number(),
  velocityKmS: z.number().nonnegative(),
  /** 0 = sunlit, 1 = umbra (satellite.js shadowFraction). */
  shadow: z.number().min(0).max(1),
  at: IsoTime,
});

export const OrbitClass = z.enum(['LEO', 'MEO', 'GEO', 'HEO']);

/** GET /api/satellites/orbit?id=&t= — ±½ period around t, split at the antimeridian. */
export const OrbitResponse = z.object({
  noradId: z.number().int(),
  name: z.string(),
  periodMinutes: z.number().positive(),
  orbitClass: OrbitClass,
  anchoredAt: IsoTime,
  /** Each segment is `[lng, lat, altKm][]`. */
  segments: z.array(z.array(z.tuple([Lng, Lat, z.number()])).max(2_000)).max(8),
  timestamp: IsoTime,
  /** Epoch of the element set the track was propagated from (layers-space). */
  elementsEpoch: IsoTime.optional(),
  /** Catalogue provider of those elements, e.g. `celestrak` or `satnogs`. (layers-space) */
  source: z.string().optional(),
  /** Status of the catalogue feed the elements came from (lookups report providers). (layers-space) */
  providers: Providers.optional(),
});

export const KpReading = z.object({
  /** Planetary K index 0–9; null when NOAA returned no valid reading (never report "Quiet" then). */
  kp: z.number().min(0).max(9).nullable(),
  observedAt: IsoTime.nullable(),
  stormLevel: z.enum(['Unknown', 'Quiet', 'Unsettled', 'G1', 'G2', 'G3', 'G4', 'G5']),
  label: z.string(),
  color: z.string(),
});

/** GET /api/space-weather */
export const SpaceWeatherResponse = Envelope.extend({
  kp: KpReading,
  kpHistory: z.array(z.object({ at: IsoTime, kp: z.number() })),
  scales: z.object({
    R: z.number().int().min(0).max(5).nullable(),
    S: z.number().int().min(0).max(5).nullable(),
    G: z.number().int().min(0).max(5).nullable(),
  }),
  xray: z.object({ flux: z.number().nullable(), class: z.string().nullable(), observedAt: IsoTime.nullable() }),
  solarWind: z.object({
    speedKmS: z.number().nullable(),
    densityPcc: z.number().nullable(),
    btNt: z.number().nullable(),
    bzNt: z.number().nullable(),
    observedAt: IsoTime.nullable(),
    /** Spacecraft the active RTSW row came from (ACE, DSCOVR, IMAP). */
    source: z.string().nullable(),
  }),
  alerts: z.array(z.object({ id: z.string(), issuedAt: IsoTime, message: z.string() })),
});

/** GET /api/iss — wheretheiss.at position (the Space Cam also propagates NORAD 25544 locally). */
export const IssResponse = Envelope.extend({
  lat: Lat,
  lng: Lng,
  altKm: z.number(),
  velocityKmH: z.number(),
  visibility: z.enum(['daylight', 'eclipsed']).nullable(),
  /**
   * Ground track PROPAGATED (SGP4) from NORAD 25544's published elements, not observed: from 45 min
   * before to 90 min after `anchoredAt`, split at the antimeridian. Null when the catalogue has no
   * ISS elements yet. (layers-space)
   */
  groundTrack: z
    .object({
      anchoredAt: IsoTime,
      elementsEpoch: IsoTime,
      source: z.string(),
      segments: z.array(z.array(z.tuple([Lng, Lat, z.number()])).max(2_000)).max(8),
    })
    .nullable()
    .optional(),
});
