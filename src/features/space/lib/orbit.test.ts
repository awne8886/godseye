import { describe, expect, it } from 'vitest';
import { jday, shadowFraction, sunPos } from 'satellite.js';
import { fx } from '../__fixtures__';
import { ommToRecord, recordToOmm } from './catalog';
import { anchorTime, groundTrack, orbitClass, orbitTrack, periodMinutes, propagateAt, satrecFromOmm, splitTrackAtAntimeridian, type TrackPoint } from './orbit';
import { inEarthShadow, sunDirection } from './shadow';
import { displayAltM, propagateBatch } from './propagate-batch';

const AT = Date.parse('2026-09-30T18:00:00Z');
const issRec = ommToRecord(fx.active.find((o) => o.NORAD_CAT_ID === 25544)!)!;
const issSat = satrecFromOmm(recordToOmm(issRec))!;

describe('SGP4 propagation', () => {
  it('propagates the ISS to a plausible, deterministic position', () => {
    const a = propagateAt(issSat, new Date(AT))!;
    const b = propagateAt(issSat, new Date(AT))!;
    expect(a).toEqual(b);
    expect(a.altKm).toBeGreaterThan(400);
    expect(a.altKm).toBeLessThan(440);
    expect(Math.abs(a.lat)).toBeLessThanOrEqual(51.7);
    expect(a.velocityKmS).toBeGreaterThan(7.5);
    expect(a.velocityKmS).toBeLessThan(7.8);
  });

  it('agrees with wheretheiss.at within a few km of altitude and < 1° of position at its timestamp', () => {
    const w = fx.iss as { latitude: number; longitude: number; altitude: number; timestamp: number };
    const p = propagateAt(issSat, new Date(w.timestamp * 1000))!;
    expect(Math.abs(p.lat - w.latitude)).toBeLessThan(1);
    expect(Math.abs(p.lng - w.longitude)).toBeLessThan(1);
    expect(Math.abs(p.altKm - w.altitude)).toBeLessThan(15);
  });

  it('classifies orbit regimes from the elements', () => {
    expect(orbitClass(issRec.meanMotion, issRec.eccentricity)).toBe('LEO');
    expect(orbitClass(2.00563, 0.01)).toBe('MEO'); // GPS
    expect(orbitClass(1.00273, 0.0002)).toBe('GEO');
    expect(orbitClass(2.006, 0.72)).toBe('HEO'); // Molniya: perigee is LEO, the orbit is not
    expect(periodMinutes(issRec.meanMotion)).toBeCloseTo(92.98, 1);
    expect(periodMinutes(0)).toBeNull();
  });

  it('never extrapolates an absurd anchor', () => {
    expect(anchorTime(undefined, AT).getTime()).toBe(AT);
    expect(anchorTime(AT - 3600_000, AT).getTime()).toBe(AT - 3600_000);
    expect(anchorTime(AT + 30 * 86_400_000, AT).getTime()).toBe(AT);
    expect(anchorTime(Number.NaN, AT).getTime()).toBe(AT);
  });
});

describe('orbit track and antimeridian split', () => {
  it('splits wherever consecutive longitudes jump by more than 180°', () => {
    const t: TrackPoint[] = [
      [170, 0, 400],
      [178, 1, 400],
      [-178, 2, 400],
      [-170, 3, 400],
      [-160, 4, 400],
    ];
    const s = splitTrackAtAntimeridian(t);
    expect(s).toEqual([
      [
        [170, 0, 400],
        [178, 1, 400],
      ],
      [
        [-178, 2, 400],
        [-170, 3, 400],
        [-160, 4, 400],
      ],
    ]);
    expect(splitTrackAtAntimeridian([[0, 0, 1]])).toEqual([]);
    expect(splitTrackAtAntimeridian([])).toEqual([]);
  });

  it('an ISS track centred on t passes through the marker and has no world-spanning segment', () => {
    const track = orbitTrack(issSat, issRec.meanMotion, new Date(AT), 180);
    expect(track.length).toBe(181);
    const mid = track[90]!;
    const p = propagateAt(issSat, new Date(AT))!;
    expect(mid[0]).toBeCloseTo(p.lng, 2);
    expect(mid[1]).toBeCloseTo(p.lat, 2);
    const segs = splitTrackAtAntimeridian(track);
    expect(segs.length).toBeGreaterThanOrEqual(1);
    expect(segs.length).toBeLessThanOrEqual(8);
    for (const s of segs) for (let i = 1; i < s.length; i++) expect(Math.abs(s[i]![0] - s[i - 1]![0])).toBeLessThan(180);
  });

  it('ground track samples one point per step', () => {
    expect(groundTrack(issSat, new Date(AT), 10, 60).length).toBe(11);
  });
});

describe('Earth shadow (cylindrical, Sun direction from the subsolar point)', () => {
  const equinox = Date.parse('2026-09-23T00:00:00Z');
  const solstice = Date.parse('2026-06-21T12:00:00Z');

  it('sunward points are lit, the antisolar LEO point is in shadow', () => {
    const sun = sunDirection(AT);
    const subLat = (Math.asin(sun.z) * 180) / Math.PI;
    const subLng = (Math.atan2(sun.y, sun.x) * 180) / Math.PI;
    expect(inEarthShadow(subLat, subLng, 400, sun)).toBe(false);
    expect(inEarthShadow(-subLat, subLng + 180, 400, sun)).toBe(true);
    // Beside the terminator at LEO altitude the satellite is still lit.
    expect(inEarthShadow(subLat, subLng + 95, 400, sun)).toBe(false);
  });

  it('GEO satellites are eclipsed around the equinox but not at the solstice', () => {
    const at = (t: number) => {
      const sun = sunDirection(t);
      const antiLng = (Math.atan2(-sun.y, -sun.x) * 180) / Math.PI;
      return inEarthShadow(0, antiLng, 35_786, sun);
    };
    expect(at(equinox)).toBe(true);
    expect(at(solstice)).toBe(false);
  });

  it('matches satellite.js shadowFraction along an ISS orbit (except at the penumbra edge)', () => {
    let disagreements = 0;
    for (let m = 0; m < 93; m++) {
      const t = AT + m * 60_000;
      const p = propagateAt(issSat, new Date(t))!;
      const umbra = shadowFraction(sunPos(jday(new Date(t))).rsun, p.eci) > 0.5;
      if (umbra !== inEarthShadow(p.lat, p.lng, p.altKm, sunDirection(t))) disagreements++;
    }
    expect(disagreements).toBeLessThanOrEqual(2);
  });
});

describe('bulk propagation (worker core)', () => {
  const recs = fx.active.map((o) => ommToRecord(o)!);
  const input = {
    satrecs: recs.map((r) => satrecFromOmm(recordToOmm(r))),
    noradIds: recs.map((r) => r.noradId),
    categories: recs.map((r) => ['comms', 'military', 'navigation', 'earth_obs', 'science', 'other'].indexOf(r.category)),
  };
  const palette: [number, number, number, number][] = [
    [0, 230, 118, 242],
    [255, 61, 61, 242],
    [68, 138, 255, 242],
    [144, 238, 144, 242],
    [255, 215, 0, 242],
    [0, 229, 255, 242],
  ];
  const all = new Set([0, 1, 2, 3, 4, 5]);

  it('is deterministic at a fixed time', () => {
    const a = propagateBatch(input, { at: AT, palette, visible: all, camera: null, selectedId: 25544 });
    const b = propagateBatch(input, { at: AT, palette, visible: all, camera: null, selectedId: 25544 });
    expect(a.count).toBeGreaterThan(recs.length * 0.9);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.colors)).toEqual(Array.from(b.colors));
    expect(Array.from(a.index)).toEqual(Array.from(b.index));
    expect(a.count + a.hidden + a.failed).toBe(recs.length);
    expect(a.selected?.noradId).toBe(25544);
    const i = Array.from(a.index).findIndex((k) => recs[k]!.noradId === 25544);
    expect(a.radii[i]).toBe(6);
    expect(a.positions[i * 3 + 2]).toBeCloseTo(displayAltM(a.selected!.altKm), -1);
  });

  it('dims satellites in Earth shadow and filters hidden categories', () => {
    const r = propagateBatch(input, { at: AT, palette, visible: all, camera: null, selectedId: null });
    const alphas = new Set<number>();
    for (let i = 0; i < r.count; i++) alphas.add(r.colors[i * 4 + 3]!);
    expect(alphas).toEqual(new Set([242, Math.round(242 * 0.3)]));

    // The far-side filter has its own spec: propagate-batch.test.ts.

    const navOnly = propagateBatch(input, { at: AT, palette, visible: new Set([2]), camera: null, selectedId: null });
    for (let i = 0; i < navOnly.count; i++) expect(recs[navOnly.index[i]!]!.category).toBe('navigation');
  });

  it('counts unpropagatable elements as failed, never drawn', () => {
    const r = propagateBatch({ ...input, satrecs: input.satrecs.map((s, i) => (i === 0 ? null : s)) }, { at: AT, palette, visible: all, camera: null, selectedId: null });
    expect(r.failed).toBeGreaterThanOrEqual(1);
    expect(Array.from(r.index)).not.toContain(0);
  });
});
