import { describe, expect, it } from 'vitest';
import {
  Aircraft,
  ApiError,
  FeedMeta,
  FlightsResponse,
  FLIGHT_FIELDS,
  IsoTime,
  KpReading,
  Omm,
  ProviderStatus,
  RoutePlanResponse,
} from './index';

const meta = {
  feed: 'flights', kind: 'live', state: 'live', fetchedAt: '2026-09-30T16:00:00Z', observedAt: '2026-09-30T15:59:58Z',
  lastGoodAt: '2026-09-30T16:00:00Z', stale: false, ttlSeconds: 15,
  attribution: [{ text: 'Aircraft data © adsb.lol contributors, ODbL', licence: 'ODbL' }],
} as const;

describe('shared schemas', () => {
  it('accepts UTC ISO timestamps only', () => {
    expect(IsoTime.safeParse('2026-09-30T16:04:05Z').success).toBe(true);
    expect(IsoTime.safeParse('2026-09-30T16:04:05.123Z').success).toBe(true);
    expect(IsoTime.safeParse('2026-09-30T16:04:05+02:00').success).toBe(false);
    expect(IsoTime.safeParse('1727712245').success).toBe(false);
  });

  it('requires provider status fields (§0.3)', () => {
    expect(ProviderStatus.safeParse({ ok: true, count: 10, ms: 120, age_s: 3 }).success).toBe(true);
    expect(ProviderStatus.safeParse({ ok: true, count: 10 }).success).toBe(false);
    expect(FeedMeta.safeParse(meta).success).toBe(true);
    expect(ApiError.safeParse({ error: 'not_found', detail: 'Unknown airport ZZZZ' }).success).toBe(true);
  });

  it('validates aircraft with explicit units and emergency squawks', () => {
    const a = {
      id: '4ca2b3', lat: 51.47, lng: -0.45, observedAt: '2026-09-30T16:00:00Z', source: 'adsblol', callsign: 'BAW117',
      registration: 'G-XWBA', typeCode: 'A35K', bucket: 'commercial', isHelicopter: false, onGround: false, altFt: 36000,
      altGeomFt: 36500, gsKt: 480, trackDeg: 288, vrFpm: 0, squawk: '7700', emergency: '7700', category: 'A5', nacP: 9,
      dbFlags: 0, airlineCode: 'BAW',
    };
    expect(Aircraft.safeParse(a).success).toBe(true);
    expect(Aircraft.safeParse({ ...a, trackDeg: 360 }).success).toBe(false);
    expect(Aircraft.safeParse({ ...a, id: 'XYZ' }).success).toBe(false);
    expect(Aircraft.safeParse({ ...a, squawk: '7800' }).success).toBe(false);
  });

  it('enforces the columnar field order and row width', () => {
    const row = FLIGHT_FIELDS.map(() => null);
    const ok = { meta, providers: {}, fields: [...FLIGHT_FIELDS], rows: [row], counts: { commercial: 1, private: 0, jet: 0, military: 0, total: 1, noPosition: 0 } };
    expect(FlightsResponse.safeParse(ok).success).toBe(true);
    expect(FlightsResponse.safeParse({ ...ok, fields: [...FLIGHT_FIELDS].reverse() }).success).toBe(false);
    expect(FlightsResponse.safeParse({ ...ok, rows: [row.slice(1)] }).success).toBe(false);
  });

  it('accepts OMM with 6-digit NORAD ids (post-2026-07-11 catalogue)', () => {
    const omm = {
      OBJECT_NAME: 'STARLINK-99999', OBJECT_ID: '2026-150A', EPOCH: '2026-09-30T12:00:00.000000', MEAN_MOTION: 15.1,
      ECCENTRICITY: 0.0001, INCLINATION: 53, RA_OF_ASC_NODE: 10, ARG_OF_PERICENTER: 90, MEAN_ANOMALY: 270,
      EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: 'U', NORAD_CAT_ID: 100831, ELEMENT_SET_NO: 999, REV_AT_EPOCH: 100,
      BSTAR: 0.0001, MEAN_MOTION_DOT: 0.00001, MEAN_MOTION_DDOT: 0,
    };
    expect(Omm.safeParse(omm).success).toBe(true);
  });

  it('never reports Quiet without a Kp reading', () => {
    expect(KpReading.safeParse({ kp: null, observedAt: null, stormLevel: 'Unknown', label: 'Unknown', color: '#555555' }).success).toBe(true);
  });

  it('requires ≥128 great-circle points and 10 daylight samples in a route plan', () => {
    const shape = RoutePlanResponse.shape;
    expect(shape.greatCircle.shape.points.safeParse([[0, 0]]).success).toBe(false);
    expect(shape.daylight.safeParse([]).success).toBe(false);
  });
});
