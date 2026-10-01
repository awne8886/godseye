import { describe, expect, it } from 'vitest';
import fx from './__fixtures__/route-legs-2026-10-01.json';
import { initialBearing } from '@/lib/geo';
import { legScore, listsReverse, onRouteCorridor, pickLeg, routeProgress, sameAirport, trackAlong } from './route-geometry';

// Live cases from R2's round-4 scans (positions/tracks observed 2026-10-01 05:15–05:21 UTC; VRS
// airports probed 05:52 UTC; 2-airport coordinates from OurAirports). See `_captured`.
type Case = (typeof fx.multi)[number];
const ap = (a: (string | number)[]) => ({ icao: a[0] as string, lat: a[1] as number, lng: a[2] as number });
const byCs = new Map(fx.multi.map((c) => [c.cs, c]));
const get = (cs: string): Case => byCs.get(cs)!;
const leg = (c: Case) => pickLeg(c.airports.map(ap), [c.lng, c.lat], c.trackDeg).map((a) => a.icao).join('-');

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

  it('the same two aircraft probed again at 06:07Z (api.adsb.lol /v2/callsign) cruise east: legs confirmed', () => {
    const at = (cs: string, lat: number, lng: number, tr: number) => pickLeg(get(cs).airports.map(ap), [lng, lat], tr).map((a) => a.icao).join('-');
    expect(at('DAL709', 35.893172, -110.561673, 65.97)).toBe('KSAN-KJFK');
    expect(at('DAL571', 35.917752, -111.019242, 65.1)).toBe('KSAN-KBOS');
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

describe('a leg is never one airport to itself (R2 round 5 MINOR-3)', () => {
  const ATL = { icao: 'KATL', iata: 'ATL', lat: 33.6367, lng: -84.428101 };
  const BNA = { icao: 'KBNA', iata: 'BNA', lat: 36.1245, lng: -86.6782 };

  it('sameAirport compares codes first, else a 1 km radius', () => {
    expect(sameAirport(ATL, { ...ATL })).toBe(true);
    expect(sameAirport(ATL, BNA)).toBe(false);
    expect(sameAirport({ lat: 33.6367, lng: -84.4281 }, { lat: 33.637, lng: -84.428 })).toBe(true);
    expect(sameAirport({ icao: 'KATL', lat: 0, lng: 0 }, { icao: 'KPDK', lat: 0, lng: 0 })).toBe(false);
  });

  it('a round trip without a position returns first → last (one airport: the caller withholds it)', () => {
    const [o, d] = pickLeg([ATL, BNA, ATL], null);
    expect(sameAirport(o, d)).toBe(true);
  });

  it('listsReverse finds the other leg of a round trip (and only there)', () => {
    expect(listsReverse([ATL, BNA, ATL], ATL, BNA)).toBe(true);
    expect(listsReverse([ATL, BNA, ATL], BNA, ATL)).toBe(true);
    expect(listsReverse([ATL, BNA], ATL, BNA)).toBe(false);
    expect(listsReverse([{ icao: 'KMCO', lat: 28.43, lng: -81.31 }, ATL, BNA], ATL, BNA)).toBe(false);
  });

  it('a repeated stop is skipped as a leg', () => {
    // Close to Atlanta, a zero-length ATL→ATL "leg" would score best; it is not a leg.
    expect(pickLeg([ATL, ATL, BNA], [-84.5, 33.7], 330).map((a) => a.iata)).toEqual(['ATL', 'BNA']);
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

describe('routeProgress needs the track along the leg or unknown (round 5 fix pass MINOR-1)', () => {
  const DEN = { lat: 39.8617, lng: -104.673 };
  const ORD = { lat: 41.9786, lng: -87.9048 };
  // Mid-route, on the great circle (the reviewer's scratch case).
  const mid = { lat: 41.4, lng: -96.3, speedKt: 450, altFt: 36000, vrFpm: 0 };
  const along = initialBearing([mid.lng, mid.lat], [ORD.lng, ORD.lat]);

  it('a track 100° off the leg on the corridor is standing data only: no progress', () => {
    expect(trackAlong({ ...mid, trackDeg: (along + 100) % 360 }, DEN, ORD)).toBe(false);
    expect(routeProgress(DEN, ORD, { ...mid, trackDeg: (along + 100) % 360 })).toMatchObject({ basis: 'schedule', status: 'unknown', progress: null });
  });

  it('a track along the leg, or no track, keeps the corridor progress', () => {
    const on = routeProgress(DEN, ORD, { ...mid, trackDeg: (along + 10) % 360 });
    expect(on).toMatchObject({ basis: 'corridor', status: 'airborne' });
    expect(on.progress).toBeGreaterThan(0.4);
    expect(routeProgress(DEN, ORD, { ...mid, trackDeg: null }).progress).toBe(on.progress);
  });

  it('FDB931 (OMDB→UWUU) in the recorded scans: on the corridor but tracking 288°, no progress', () => {
    const c = [...fx.two, ...fx.multi].find((x) => x.cs === 'FDB931')!;
    const [o, d] = c.airports.map(ap) as [ReturnType<typeof ap>, ReturnType<typeof ap>];
    expect(onRouteCorridor(o, d, [c.lng, c.lat])).toBe(true);
    expect(routeProgress(o, d, { lat: c.lat, lng: c.lng, speedKt: c.gsKt, trackDeg: c.trackDeg }).progress).toBeNull();
    expect(routeProgress(o, d, { lat: c.lat, lng: c.lng, speedKt: c.gsKt }).progress).not.toBeNull();
  });
});
