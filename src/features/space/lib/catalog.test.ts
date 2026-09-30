import { describe, expect, it } from 'vitest';
import { SATELLITE_FIELDS, SatellitesResponse } from '@/lib/schemas';
import { MAX_RESPONSE_BYTES } from '@/lib/respond';
import { fx } from '../__fixtures__';
import {
  COL,
  MISSIONS,
  classifySatellite,
  countByCategory,
  ommToRecord,
  recordToOmm,
  recordToRow,
  rowToRecord,
  tleChecksumOk,
  tleToOmm,
  type SatRecord,
} from './catalog';

const issOmm = fx.active.find((o) => o.NORAD_CAT_ID === 25544)!;

describe('OMM normalisation (CelesTrak FORMAT=json, §6.2)', () => {
  it('normalises the zone-less EPOCH to ISO-8601 UTC with Z', () => {
    expect(issOmm.EPOCH).toBe('2026-09-30T03:25:12.177120'); // as served: no zone designator
    const r = ommToRecord(issOmm)!;
    expect(r.epoch).toBe('2026-09-30T03:25:12.177Z');
    expect(r.noradId).toBe(25544);
    expect(r.name).toBe('ISS (ZARYA)');
    expect(r.category).toBe('science');
    expect(MISSIONS[r.missionIndex]!.name).toBe('Space station');
  });

  it('accepts 6-digit NORAD ids (catalog numbers passed 99999 on 2026-07-11)', () => {
    const six = fx.active.filter((o) => (o.NORAD_CAT_ID as number) > 99_999);
    expect(six.length).toBeGreaterThan(0);
    for (const o of six) expect(ommToRecord(o)!.noradId).toBe(o.NORAD_CAT_ID);
    expect(ommToRecord({ ...issOmm, NORAD_CAT_ID: 1_000_000 })).toBeNull();
  });

  it('drops records SGP4 cannot use instead of patching them', () => {
    expect(ommToRecord({ ...issOmm, MEAN_MOTION: undefined } as never)).toBeNull();
    expect(ommToRecord({ ...issOmm, ECCENTRICITY: 1.2 })).toBeNull();
    expect(ommToRecord({ ...issOmm, EPOCH: 'not a date' })).toBeNull();
    expect(ommToRecord(null)).toBeNull();
  });

  it('every fixture record normalises and round-trips through the columnar row', () => {
    for (const o of fx.active) {
      const r = ommToRecord(o)!;
      expect(r).not.toBeNull();
      const back = rowToRecord(recordToRow(r));
      expect(back).toEqual(r);
      const omm = recordToOmm(back);
      expect(omm.NORAD_CAT_ID).toBe(o.NORAD_CAT_ID);
      expect(omm.MEAN_MOTION).toBe(o.MEAN_MOTION);
    }
    expect(SATELLITE_FIELDS[COL.category]).toBe('category');
  });
});

describe('category mapping', () => {
  const cases: [string, string[], string, string][] = [
    ['NAVSTAR 43 (USA 132)', [], 'navigation', 'GPS'], // GPS before the "USA nnn" military rule
    ['COSMOS 2433 [GLONASS-M]', [], 'navigation', 'GLONASS'],
    ['GSAT0101 (GALILEO-PFM)', [], 'navigation', 'Galileo'],
    ['BEIDOU-2 G1', [], 'navigation', 'BeiDou'],
    ['USA 115 (MILSTAR-1 2)', [], 'military', 'US military'],
    ['YAOGAN-2', [], 'military', 'Chinese military'],
    ['STARLINK-1007', [], 'comms', 'Starlink'],
    ['STARLINK-1007 DEB', [], 'other', 'Debris / rocket body'],
    ['SL-4 R/B', [], 'other', 'Debris / rocket body'],
    ['GOES 16', [], 'earth_obs', 'Weather'],
    ['EWS-G2 (GOES 15)', [], 'earth_obs', 'Weather'],
    ['SENTINEL-2A', [], 'earth_obs', 'Earth imaging'],
    ['HST', [], 'science', 'Space telescope'],
    ['CSS (TIANHE)', [], 'science', 'Space station'],
    ['USASAT-1', [], 'other', 'Unclassified'], // OSIRIS substring "USA" false positive
    ['MISSIONSAT', [], 'other', 'Unclassified'], // OSIRIS substring "ISS" false positive
    ['SOYUZ-MS 29', ['active', 'stations'], 'science', 'Station traffic'],
    ['COSMOS 1989 (ETALON 1)', ['active', 'geodetic'], 'science', 'Geodesy'],
    ['ODD SAT', ['active', 'military'], 'military', 'Military (CelesTrak list)'],
  ];
  it.each(cases)('%s → %s', (name, groups, category, mission) => {
    const c = classifySatellite(name, groups);
    expect(c.category).toBe(category);
    expect(MISSIONS[c.missionIndex]!.name).toBe(mission);
  });

  it('mission colours are the category tokens (never ad-hoc hex)', () => {
    for (const m of MISSIONS) expect(m.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(new Set(MISSIONS.filter((m) => m.category === 'navigation').map((m) => m.color)).size).toBe(1);
  });

  it('counts categories from rows', () => {
    const rows = fx.active.map((o) => recordToRow(ommToRecord(o)!));
    const counts = countByCategory(rows);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(rows.length);
    expect(counts.comms).toBeGreaterThan(0);
  });
});

describe('TLE → OMM (SatNOGS fallback)', () => {
  const sn = fx.satnogs.find((t) => t.norad_cat_id === 25544)!;
  it('parses the same ISS element set CelesTrak serves as OMM', () => {
    const omm = tleToOmm(sn.tle0 as string, sn.tle1 as string, sn.tle2 as string, 25544)!;
    expect(omm.OBJECT_NAME).toBe('ISS (ZARYA)');
    expect(omm.OBJECT_ID).toBe('1998-067A');
    expect(Date.parse(omm.EPOCH)).toBeCloseTo(Date.parse('2026-09-30T03:25:12.177Z'), -1);
    expect(omm.MEAN_MOTION).toBeCloseTo(issOmm.MEAN_MOTION as number, 8);
    expect(omm.ECCENTRICITY).toBeCloseTo(issOmm.ECCENTRICITY as number, 7);
    expect(omm.INCLINATION).toBeCloseTo(issOmm.INCLINATION as number, 4);
    expect(omm.BSTAR).toBeCloseTo(issOmm.BSTAR as number, 9);
    expect(omm.MEAN_MOTION_DOT).toBeCloseTo(issOmm.MEAN_MOTION_DOT as number, 9);
  });

  it('rejects a corrupted line (checksum) instead of guessing', () => {
    const bad = (sn.tle2 as string).replace('51.6314', '51.6315');
    expect(tleChecksumOk(sn.tle2 as string)).toBe(true);
    expect(tleChecksumOk(bad)).toBe(false);
    expect(tleToOmm('X', sn.tle1 as string, bad, 25544)).toBeNull();
  });

  it('every SatNOGS fixture item converts', () => {
    const out = fx.satnogs.map((t) => tleToOmm(t.tle0 as string, t.tle1 as string, t.tle2 as string, t.norad_cat_id as number));
    expect(out.filter(Boolean).length).toBe(fx.satnogs.length);
    for (const o of out) expect(ommToRecord(o!, ['satnogs'])).not.toBeNull();
  });
});

describe('payload size (§4: every response < 4 MB uncompressed)', () => {
  it('the full active catalogue plus 20 % growth fits as SATELLITE_FIELDS rows', () => {
    // 2026-09-30: `active` held 16 612 objects (6 993 014 B of OMM JSON). Build 20 000 rows from the
    // real fixture records (test-only fixture: distinct ids so nothing dedupes), worst-case group names.
    const base: SatRecord[] = fx.active.map((o) => ommToRecord(o, ['active', 'glonass-operational'])!);
    const rows = Array.from({ length: 20_000 }, (_, i) => recordToRow({ ...base[i % base.length]!, noradId: 100_000 + i, group: 'glonass-operational' }));
    const body = {
      fields: SATELLITE_FIELDS,
      rows,
      missions: MISSIONS,
      categoryCounts: countByCategory(rows),
      catalogueSource: 'celestrak',
      meta: { feed: 'satellites', kind: 'live', state: 'live', fetchedAt: '2026-09-30T18:05:00.000Z', observedAt: '2026-09-30T17:00:00.000Z', lastGoodAt: '2026-09-30T18:05:00.000Z', stale: false, ttlSeconds: 7200, attribution: [{ text: 'CelesTrak' }] },
      providers: { celestrak: { ok: true, count: 20_000, ms: 2400, age_s: 0 } },
    };
    expect(SatellitesResponse.safeParse(body).success).toBe(true);
    const bytes = Buffer.byteLength(JSON.stringify(body));
    expect(bytes).toBeLessThan(MAX_RESPONSE_BYTES);
    expect(bytes / rows.length).toBeLessThan(200);
  });
});
