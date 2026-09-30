import { describe, expect, it } from 'vitest';
import { KpReading } from '@/lib/schemas';
import { fx } from '../__fixtures__';
import { kpReading, parseAlerts, parseKp, parseRtswMag, parseRtswWind, parseScales, parseXray, RTSW_RANGES, solarWind, xrayClass } from './swpc';

describe('Kp (products/noaa-planetary-k-index.json is an array of objects, §6.2)', () => {
  it('parses objects; time_tag is the zone-less 3-hour interval start → ISO Z', () => {
    const pts = parseKp(fx.kp);
    expect(pts.length).toBe(62);
    expect(pts.at(-1)).toEqual({ at: '2026-09-30T15:00:00.000Z', kp: 0.33 });
    expect(pts[0]!.at < pts.at(-1)!.at).toBe(true);
  });

  it('refuses the retired array-of-arrays shape instead of misreading it', () => {
    expect(parseKp([['time_tag', 'Kp', 'a_running', 'station_count'], ['2026-09-30 15:00:00.000', '0.33', '2', '8']])).toEqual([]);
    expect(parseKp(null)).toEqual([]);
  });

  it('drops invalid readings rather than zeroing them', () => {
    expect(parseKp([{ time_tag: '2026-09-30T15:00:00', Kp: null }, { time_tag: '2026-09-30T18:00:00', Kp: 12 }, { time_tag: 'x', Kp: 3 }])).toEqual([]);
  });

  it.each([
    [0.33, 'Quiet', 'Quiet'],
    [2.33, 'Quiet', 'Quiet'],
    [2.67, 'Unsettled', 'Unsettled'],
    [4, 'Unsettled', 'Active'],
    [4.67, 'G1', 'Minor storm (G1)'],
    [5.67, 'G2', 'Moderate storm (G2)'],
    [6.67, 'G3', 'Strong storm (G3)'],
    [7.67, 'G4', 'Severe storm (G4)'],
    [9, 'G5', 'Extreme storm (G5)'],
  ])('Kp %s → %s', (kp, level, label) => {
    const r = kpReading(kp, '2026-09-30T15:00:00.000Z');
    expect(r.stormLevel).toBe(level);
    expect(r.label).toBe(label);
    expect(KpReading.safeParse(r).success).toBe(true);
  });

  it('never reports Quiet without a reading', () => {
    const r = kpReading(null, null);
    expect(r).toMatchObject({ kp: null, observedAt: null, stormLevel: 'Unknown' });
    expect(r.label).not.toMatch(/quiet/i);
    expect(kpReading(Number.NaN, null).stormLevel).toBe('Unknown');
  });
});

describe('RTSW solar wind (/json/rtsw/, active rows only)', () => {
  it('takes the newest ACTIVE mag row (SOLAR1 in the fixture), not the newest row (IMAP, inactive)', () => {
    const m = parseRtswMag(fx.mag)!;
    expect((fx.mag as { active: boolean; source: string }[])[0]).toMatchObject({ active: false, source: 'IMAP' });
    expect(m.source).toBe('SOLAR1');
    expect(m.observedAt).toBe('2026-09-30T17:58:00.000Z');
    expect(m.btNt).toBe(4.44);
    expect(m.bzNt).toBe(0.49); // GSM component
  });

  it('takes the newest active plasma row with sane speed and density', () => {
    const w = parseRtswWind(fx.wind)!;
    const rows = fx.wind as { active: boolean; time_tag: string; proton_speed: number }[];
    const newestActive = rows.filter((r) => r.active).sort((a, b) => b.time_tag.localeCompare(a.time_tag))[0]!;
    expect(w.observedAt).toBe(`${newestActive.time_tag}.000Z`);
    expect(w.speedKmS).toBeGreaterThanOrEqual(RTSW_RANGES.speedKmS[0]);
  });

  it('skips out-of-range and inactive rows; null when none qualify', () => {
    const rows = [
      { time_tag: '2026-09-30T18:00:00', active: true, source: 'ACE', proton_speed: 99_999, proton_density: 5 },
      { time_tag: '2026-09-30T17:59:00', active: false, source: 'IMAP', proton_speed: 400, proton_density: 5 },
      { time_tag: '2026-09-30T17:58:00', active: true, source: 'ACE', proton_speed: 410, proton_density: -1 },
      { time_tag: '2026-09-30T17:57:00', active: true, source: 'ACE', proton_speed: 420, proton_density: 4 },
    ];
    expect(parseRtswWind(rows)).toEqual({ speedKmS: 420, densityPcc: 4, observedAt: '2026-09-30T17:57:00.000Z', source: 'ACE' });
    expect(parseRtswWind(rows.slice(0, 3))).toBeNull();
    expect(parseRtswMag([{ time_tag: '2026-09-30T18:00:00', active: true, bt: null, bz_gsm: 1 }])).toBeNull();
  });

  it('combines plasma + mag with the older observation time and both sources', () => {
    const sw = solarWind(
      { speedKmS: 400, densityPcc: 5, observedAt: '2026-09-30T17:58:00.000Z', source: 'SOLAR1' },
      { btNt: 4, bzNt: -2, observedAt: '2026-09-30T17:57:00.000Z', source: 'ACE' },
    );
    expect(sw).toEqual({ speedKmS: 400, densityPcc: 5, btNt: 4, bzNt: -2, observedAt: '2026-09-30T17:57:00.000Z', source: 'SOLAR1 / ACE' });
    expect(solarWind(null, null)).toEqual({ speedKmS: null, densityPcc: null, btNt: null, bzNt: null, observedAt: null, source: null });
  });
});

describe('GOES X-ray class (0.1–0.8 nm)', () => {
  it.each([
    [5e-9, 'A0.5'],
    [1e-8, 'A1.0'],
    [9.99e-8, 'B1.0'],
    [1e-7, 'B1.0'],
    [2.7614936e-7, 'B2.8'],
    [9.96e-7, 'C1.0'],
    [1e-6, 'C1.0'],
    [4.44e-6, 'C4.4'],
    [1e-5, 'M1.0'],
    [9.96e-5, 'X1.0'],
    [1e-4, 'X1.0'],
    [2.5e-3, 'X25.0'],
  ])('%s W/m² → %s', (flux, cls) => expect(xrayClass(flux)).toBe(cls));

  it('has no class without a valid flux', () => {
    expect(xrayClass(0)).toBeNull();
    expect(xrayClass(-1e-6)).toBeNull();
    expect(xrayClass(Number.NaN)).toBeNull();
    expect(xrayClass(null)).toBeNull();
  });

  it('uses the newest long-channel sample, not the 0.05–0.4 nm channel', () => {
    const x = parseXray(fx.xrays);
    expect(x.observedAt).toBe('2026-09-30T18:03:00.000Z');
    expect(x.flux).toBeCloseTo(2.7614936470854445e-7, 15);
    expect(x.class).toBe('B2.8');
    expect(parseXray([{ time_tag: '2026-09-30T18:03:00Z', flux: 1e-5, energy: '0.05-0.4nm' }])).toEqual({ flux: null, class: null, observedAt: null });
  });
});

describe('scales and alerts', () => {
  it('reads the current R/S/G levels', () => {
    expect(parseScales(fx.scales)).toEqual({ R: 0, S: 0, G: 0 });
    expect(parseScales({})).toEqual({ R: null, S: null, G: null });
    expect(parseScales({ '0': { R: { Scale: '7' }, S: { Scale: null }, G: { Scale: '2' } } })).toEqual({ R: null, S: null, G: 2 });
  });

  it('parses alerts: "YYYY-MM-DD hh:mm:ss.sss" → ISO Z, unique ids, newest first, plain text', () => {
    const a = parseAlerts(fx.alerts);
    expect(a.length).toBeGreaterThan(0);
    expect(a.every((x) => /Z$/.test(x.issuedAt))).toBe(true);
    const first = (fx.alerts as { product_id: string; issue_datetime: string }[])[0]!;
    expect(first.issue_datetime).toBe('2026-09-30 10:04:50.050');
    expect(a.some((x) => x.issuedAt === '2026-09-30T10:04:50.050Z' && x.id === `${first.product_id}-2026-09-30T10:04:50.050Z`)).toBe(true);
    expect(new Set(a.map((x) => x.id)).size).toBe(a.length);
    for (let i = 1; i < a.length; i++) expect(a[i - 1]!.issuedAt >= a[i]!.issuedAt).toBe(true);
    expect(a.every((x) => !x.message.includes('\r'))).toBe(true);
    expect(parseAlerts([])).toEqual([]);
  });
});
