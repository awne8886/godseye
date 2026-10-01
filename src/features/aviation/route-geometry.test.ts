import { describe, expect, it } from 'vitest';
import fx from './__fixtures__/route-legs-2026-10-01.json';
import { directionConflict, lastLowEnd, legScore, onRouteCorridor, pickLeg, routeProgress } from './route-geometry';

// Live cases from R2's round-4 scans (positions/tracks observed 2026-10-01 05:15–05:21 UTC; VRS
// airports probed 05:52 UTC; 2-airport coordinates from OurAirports). See `_captured`.
type Case = (typeof fx.multi)[number];
const ap = (a: (string | number)[]) => ({ icao: a[0] as string, lat: a[1] as number, lng: a[2] as number });
const byCs = new Map(fx.multi.map((c) => [c.cs, c]));
const get = (cs: string): Case => byCs.get(cs)!;
const leg = (c: Case) => pickLeg(c.airports.map(ap), [c.lng, c.lat], c.trackDeg).map((a) => a.icao).join('-');
const pos = (c: Case) => ({ lat: c.lat, lng: c.lng, speedKt: c.gsKt, trackDeg: c.trackDeg });

/** The leg each multi-stop aircraft was observed flying (corridor + course; checked by hand). */
const EXPECTED: Record<string, string> = {
  IGO537: 'VOBL-VOHS', AXB2786: 'VOBL-VERC', IGO913: 'VOCI-VOHS', IGO6181: 'VOMM-VOVZ', IGO927: 'VEGT-VOMM', IGO524: 'VOBL-VEAT',
  IGO6542: 'VEGT-VOBL', IGO703: 'VEBS-VOBL', CQH6465: 'ZGNN-VTBS', CHH7698: 'ZSNJ-ZJSY', CDC8241: 'ZSJX-ZJHK', CSH842: 'VTBS-ZSPD',
  VIV7089: 'MMCL-MMMY', VIV7017: 'MMSM-MMMY', THY169: 'WSSS-LTFM', UAE17K: 'OMDB-LCLK', UAL2671: 'KDEN-KBOS', UAL2033: 'KDEN-KLGA',
  AFR832: 'DXXX-LFPG', UAL2400: 'KBOS-KSFO', UAL233: 'KSFO-KPHX', UAL1828: 'KORD-KSMF', UAL406: 'KSFO-KLAS', UAL1702: 'KSFO-KIAH',
  UAL301: 'KSFO-KDEN', SWA1413: 'KMDW-KOAK', UAL2123: 'KDEN-KSFO', DAL2447: 'KSEA-KPHX', UAL2866: 'KSFO-KSBA', UAL552: 'KSFO-KONT',
  UAL1134: 'KEWR-CYVR', UAL308: 'KORD-KSNA', DAL571: 'KSAN-KBOS', DAL709: 'KSAN-KJFK', UAL2641: 'KEWR-KLAX', UAL712: 'KEWR-KLAX',
  UAL1609: 'KIAH-KSFO', UAL2282: 'KLAX-KIAD', UAL658: 'KORD-KONT',
};

describe('pickLeg: weighted score, not a yes/no direction gate (R2 round 4 BLOCKING-1)', () => {
  it('DAL709 (KJFK-KSAN-KJFK) climbing out of San Diego on track 078: KSAN→KJFK', () => {
    expect(leg(get('DAL709'))).toBe('KSAN-KJFK');
  });

  it('DAL571 (KBOS-KSAN-KBOS) 8 km after take-off on runway heading 302: KSAN→KBOS', () => {
    expect(leg(get('DAL571'))).toBe('KSAN-KBOS');
  });

  it('AFR832 (LFPG-DNAA-DXXX-LFPG) on final into CDG, track 265: DXXX→LFPG', () => {
    expect(leg(get('AFR832'))).toBe('DXXX-LFPG');
  });

  it(`picks the observed leg in all ${Object.keys(EXPECTED).length} live multi-leg cases on a leg's corridor`, () => {
    const wrong = Object.entries(EXPECTED).filter(([cs, want]) => leg(get(cs)) !== want);
    expect(wrong).toEqual([]);
  });

  it('the remaining live multi-leg aircraft are off every listed leg (no leg asserted)', () => {
    const rest = fx.multi.filter((c) => c.airports.length > 2 && !(c.cs in EXPECTED));
    expect(rest.map((c) => c.cs).sort()).toEqual(['AAL3131', 'DAL1442', 'KYE9521', 'UAL1564']);
    for (const c of rest) {
      const aps = c.airports.map(ap);
      const onAny = aps.slice(1).some((b, i) => onRouteCorridor(aps[i]!, b, [c.lng, c.lat]));
      expect(onAny, c.cs).toBe(false);
    }
  });

  it('a perpendicular track is penalised (score grows with the angle off the leg destination)', () => {
    const c = get('DAL709');
    const [jfk, san] = c.airports.map(ap) as [ReturnType<typeof ap>, ReturnType<typeof ap>];
    const here: [number, number] = [c.lng, c.lat];
    expect(legScore(jfk, san, here, 78)).toBeGreaterThan(legScore(san, jfk, here, 78));
    expect(legScore(jfk, san, here, null)).toBeCloseTo(legScore(san, jfk, here, null), 6);
  });
});

describe('directionConflict on 2-airport routes', () => {
  it('flags UAL1118 (KDEN-KCID flown westbound away from CID) and WZZ1738 (LFSB-LWSK flown toward Basel)', () => {
    for (const cs of ['UAL1118', 'WZZ1738']) {
      const c = get(cs);
      const [o, d] = c.airports.map(ap) as [ReturnType<typeof ap>, ReturnType<typeof ap>];
      expect(directionConflict(o, d, pos(c)), cs).toBe(true);
      expect(directionConflict(d, o, pos(c)), `${cs} reversed`).toBe(false);
    }
  });

  it(`flags none of the ${fx.two.length} other live 2-airport aircraft (departure turns and arrival vectors near the ends included)`, () => {
    const flagged = fx.two.filter((c) => {
      const [o, d] = c.airports.map(ap) as [ReturnType<typeof ap>, ReturnType<typeof ap>];
      return directionConflict(o, d, pos(c as Case));
    });
    expect(flagged.map((c) => c.cs)).toEqual([]);
    const on = fx.two.filter((c) => onRouteCorridor(ap(c.airports[0]!), ap(c.airports[1]!), [c.lng, c.lat])).length;
    expect(on).toBeGreaterThan(680);
  });

  it('needs an observed track', () => {
    const c = get('UAL1118');
    const [o, d] = c.airports.map(ap) as [ReturnType<typeof ap>, ReturnType<typeof ap>];
    expect(directionConflict(o, d, { ...pos(c), trackDeg: null })).toBe(false);
    expect(directionConflict(o, d, null)).toBe(false);
  });
});

describe('lastLowEnd (flown-track corroboration, AGL)', () => {
  const den = { lat: 39.8617, lng: -104.673, elevationFt: 5434 };
  const cid = { lat: 41.8847, lng: -91.7108, elevationFt: 869 };
  const pt = (lat: number, lng: number, altFt: number | null, onGround = false) => ({ lat, lng, altFt, onGround });

  it('a take-off from the listed destination', () => {
    expect(lastLowEnd([pt(41.88, -91.72, null, true), pt(41.9, -91.9, 2500), pt(42.3, -92.1, 20000)], den, cid)).toBe('d');
  });

  it('low near Denver is above field elevation + 3,000 ft only from 8,434 ft MSL', () => {
    expect(lastLowEnd([pt(39.9, -104.6, 7900), pt(40.5, -100, 35000)], den, cid)).toBe('o');
    expect(lastLowEnd([pt(39.9, -104.6, 9000), pt(40.5, -100, 35000)], den, cid)).toBeNull();
  });

  it('a low point elsewhere, or none, corroborates nothing', () => {
    expect(lastLowEnd([pt(42.0, -87.9, 0, true), pt(42.2, -90, 30000)], den, cid)).toBeNull();
    expect(lastLowEnd([], den, cid)).toBeNull();
  });
});

describe('routeProgress', () => {
  it('uses the exact position: two positions in one 0.5° cell give different progress', () => {
    const o = { lat: 51.47, lng: -0.46 };
    const d = { lat: 40.64, lng: -73.78 };
    const a = routeProgress(o, d, { lat: 53.26, lng: -30.24, speedKt: 480 });
    const b = routeProgress(o, d, { lat: 53.26, lng: -29.76, speedKt: 480 });
    expect(a.basis).toBe('corridor');
    expect(a.progress).not.toBe(b.progress);
  });
});
