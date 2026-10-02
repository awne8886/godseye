import { describe, expect, it } from 'vitest';
import type { Omm } from '@/lib/types';
import { FIXTURE_CAPTURED_AT, fx } from '../__fixtures__';
import { propagateAt, satrecFromOmm } from './orbit';
import { lookAt, nextPass } from './passes';

const iss = satrecFromOmm(fx.stations.find((o) => o.NORAD_CAT_ID === 25544) as unknown as Omm)!;
const LONDON = { lat: 51.5, lng: -0.12 };

describe('nextPass (predicted, over a chosen ground point)', () => {
  it('finds the ISS rising over London within a day, bounded by samples below the mask', () => {
    const r = nextPass(iss, LONDON, FIXTURE_CAPTURED_AT);
    expect(r.kind).toBe('pass');
    if (r.kind !== 'pass') return;
    const p = r.pass;
    expect(p.aosMs).toBeGreaterThanOrEqual(FIXTURE_CAPTURED_AT);
    expect(p.aosMs).toBeLessThan(FIXTURE_CAPTURED_AT + 24 * 3_600_000);
    expect(p.aosMs).toBeLessThanOrEqual(p.maxMs);
    expect(p.losMs).not.toBeNull();
    expect(p.maxMs).toBeLessThanOrEqual(p.losMs!);
    expect(p.maxElevationDeg).toBeGreaterThanOrEqual(10);
    expect(p.maxElevationDeg).toBeLessThanOrEqual(90);
    // A LEO pass lasts minutes, not hours.
    expect(p.losMs! - p.aosMs).toBeLessThan(15 * 60_000);
    // The sample before AOS and after LOS are below the mask: the times are real edges, ±30 s.
    if (!r.inProgress) expect(lookAt(iss, LONDON, p.aosMs - 30_000)!.el).toBeLessThan(10);
    expect(lookAt(iss, LONDON, p.losMs! + 30_000)!.el).toBeLessThan(10);
    expect(lookAt(iss, LONDON, p.maxMs)!.el).toBeCloseTo(p.maxElevationDeg, 6);
  });

  it('reports no pass where the orbit never climbs above the mask (ISS from the North Pole)', () => {
    expect(nextPass(iss, { lat: 89.9, lng: 0 }, FIXTURE_CAPTURED_AT).kind).toBe('none');
  });

  it('reports a geostationary satellite seen from under it as always up, not as a pass', () => {
    const geo = satrecFromOmm({
      OBJECT_NAME: 'GEO TEST',
      OBJECT_ID: '2000-001A',
      EPOCH: '2026-09-30T00:00:00.000000',
      MEAN_MOTION: 1.00273,
      ECCENTRICITY: 0.0001,
      INCLINATION: 0.02,
      RA_OF_ASC_NODE: 80,
      ARG_OF_PERICENTER: 270,
      MEAN_ANOMALY: 90,
      EPHEMERIS_TYPE: 0,
      CLASSIFICATION_TYPE: 'U',
      NORAD_CAT_ID: 99001,
      ELEMENT_SET_NO: 999,
      REV_AT_EPOCH: 1,
      BSTAR: 0,
      MEAN_MOTION_DOT: 0,
      MEAN_MOTION_DDOT: 0,
    } as Omm)!;
    const sub = propagateAt(geo, new Date(FIXTURE_CAPTURED_AT))!;
    expect(nextPass(geo, { lat: 0, lng: sub.lng }, FIXTURE_CAPTURED_AT, { stepSeconds: 600 }).kind).toBe('always-up');
  });
});
