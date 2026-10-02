// Phase 1 review A: json2satrec accepts CelesTrak's EPOCH with or without a trailing Z.
import { describe, expect, it } from 'vitest';
import { json2satrec } from 'satellite.js';

const base = {
  OBJECT_NAME: 'ISS (ZARYA)', OBJECT_ID: '1998-067A', EPOCH: '2026-09-30T03:25:12.177120', MEAN_MOTION: 15.48692916,
  ECCENTRICITY: 0.00070362, INCLINATION: 51.6314, RA_OF_ASC_NODE: 140.6663, ARG_OF_PERICENTER: 204.8576,
  MEAN_ANOMALY: 155.2074, EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: 'U', NORAD_CAT_ID: 25544, ELEMENT_SET_NO: 999,
  REV_AT_EPOCH: 58802, BSTAR: 7.1684861e-5, MEAN_MOTION_DOT: 3.46e-5, MEAN_MOTION_DDOT: 0,
};

describe('R-A11 SATELLITE_FIELDS.epoch format', () => {
  it('raw CelesTrak EPOCH and a Z-normalised EPOCH give the same satrec epoch', () => {
    type Rec = { jdsatepoch: number; jdsatepochF?: number };
    const jd = (r: Rec) => r.jdsatepoch + (r.jdsatepochF ?? 0);
    const raw = json2satrec(base as never) as unknown as Rec;
    const z = json2satrec({ ...base, EPOCH: '2026-09-30T03:25:12.177120Z' } as never) as unknown as Rec;
    const ms = json2satrec({ ...base, EPOCH: '2026-09-30T03:25:12.177Z' } as never) as unknown as Rec;
    expect(jd(z)).toBeCloseTo(jd(raw), 8);
    expect(jd(ms)).toBeCloseTo(jd(raw), 8);
  });
});
