// R4 round 5 B1: "AS FLOWN (OBSERVED)" relabelled a standing-data route in reverse (D→O, with
// progress and an ETA) for aircraft that took off from the listed destination D but were flying
// to a THIRD airport: flyingRoute() accepts a track up to 60° off the local path bearing inside the
// 1.15× + 150 km corridor, and any track while climbing within 150 km of D. A leg no source lists is
// now shown only when the observation fits it end to end (reverseLegReject): > 150 km from D, track
// ≤ 45° off the direct bearing to O, and ≤ max(150 km, 0.2 × route) off the great circle now and
// along the trace since the take-off.
// Fixture: all 25 observed-reverse answers of the reviewer's two live scans (2026-10-01 14:04–14:31Z):
// /api/flight answers + the adsb.lol traces behind them (thinned) + the vertical rate (see `vr`).
// Seven were wrong (later seen at RDU, near BNA, descending near HLN/GTF, near LRD, or still heading
// away from SCK/IDA/SEA); eighteen flew the reversed pair.
import { describe, expect, it } from 'vitest';
import type { FlightRecord } from '@/features/aviation/adsb';
import type { TrackPoint } from '@/features/aviation/trace';
import { flightDetail, type FlightDeps } from './flight';
import fixture from '../__fixtures__/r5/observed-reverse-live.json';

interface Case {
  cs: string;
  hex: string;
  verdict: 'wrong' | 'right';
  routeO: { icao: string; iata: string };
  routeD: { icao: string; iata: string };
  shownRound5: string;
  vr: { vrFpm: number | null } | null;
  position: { lat: number; lng: number; altFt: number | null; gsKt: number | null; trackDeg: number | null; observedAt: string };
  track: [string, number, number, number | null, 0 | 1, number | null, number | null][];
}
const cases = fixture.cases as unknown as Case[];
const ok = { ok: true, count: 1, ms: 1, age_s: 0 };

function record(c: Case): FlightRecord {
  const p = c.position;
  return {
    id: c.hex, callsign: c.cs, registration: null, typeCode: null, bucket: 'commercial', isHelicopter: false, onGround: false, lat: p.lat, lng: p.lng, altFt: p.altFt,
    altGeomFt: null, gsKt: p.gsKt, trackDeg: p.trackDeg, vrFpm: c.vr?.vrFpm ?? null, squawk: null, emergency: null, category: 'A3', nacP: 9, dbFlags: 0,
    seenAt: Date.parse(p.observedAt) / 1000, source: 'adsblol_callsign', posSource: 'adsb',
  } as unknown as FlightRecord;
}

const track = (c: Case): TrackPoint[] => c.track.map(([t, lat, lng, altFt, g, gsKt, trackDeg]) => ({ t, lat, lng, altFt, onGround: g === 1, gsKt, trackDeg }) as TrackPoint);

async function detail(c: Case) {
  const now = Date.parse(c.position.observedAt) + 5_000;
  const route = { found: true, source: 'vrs', stale: false, sourceUpdatedAt: '2026-09-20', origin: c.routeO, destination: c.routeD, providers: { vrs: ok } };
  const deps = {
    records: async () => ({ records: [record(c)], run: { status: ok, okAt: now }, state: 'live' }),
    adsblol: async () => [],
    adsbdbRegistration: async () => null,
    route: async () => route,
    aircraft: async () => ({ track: track(c), identity: null, providers: { adsblol_trace: ok } }),
    weather: async () => ({ byStation: new Map(), providers: {} }),
  } as unknown as FlightDeps;
  return (await flightDetail(c.cs, deps, now))!;
}

describe('observed-reverse relabel needs the reverse leg end to end (round 5 B1, live fixtures)', () => {
  it('the fixture holds the reviewer’s 25 relabels: 7 wrong, 18 right', () => {
    expect(cases).toHaveLength(25);
    expect(cases.filter((c) => c.verdict === 'wrong').map((c) => c.cs).sort()).toEqual(['AAY50', 'AAY664', 'AAY83', 'SWA2331', 'SWA2816', 'SWA4623', 'UAL2031']);
  });

  for (const c of cases.filter((x) => x.verdict === 'wrong')) {
    it(`${c.cs}: departed ${c.routeD.iata}, flying elsewhere — not shown ${c.shownRound5} with progress/ETA; withheld with a reason`, async () => {
      const d = await detail(c);
      expect({ origin: d.origin, destination: d.destination, progress: d.progress, eta: d.eta, routeBasis: d.routeBasis }).toEqual({ origin: null, destination: null, progress: null, eta: null, routeBasis: null });
      expect(d.routeCheck).toMatch(new RegExp(`^observed departure ${c.routeD.iata}; .+ — ${c.routeD.iata}→${c.routeO.iata} is not listed by any source and is not confirmed`));
      // The observed track is still drawn (it is what was observed), only the route is withheld.
      expect(d.flownTrack.length).toBeGreaterThan(0);
    });
  }

  for (const c of cases.filter((x) => x.verdict === 'right' && x.cs !== 'SWT183')) {
    it(`${c.cs}: flew ${c.shownRound5} — still shown AS FLOWN with progress`, async () => {
      const d = await detail(c);
      expect(`${d.origin?.iata}→${d.destination?.iata}`).toBe(c.shownRound5);
      expect(d.routeBasis).toBe('observed-reverse');
      expect(d.progress).toEqual(expect.any(Number));
    });
  }

  it('SWT183 (91 km out of MAD; its vertical rate was not captured): withheld until its course says TFN', async () => {
    const d = await detail(cases.find((x) => x.cs === 'SWT183')!);
    expect({ routeBasis: d.routeBasis, progress: d.progress, eta: d.eta }).toEqual({ routeBasis: null, progress: null, eta: null });
    expect(d.routeCheck).toMatch(/^observed departure MAD/);
  });

  it('the reasons are specific: SWA2816 not on course for MDW; AAY83 (climbing 57 km out of LAS) not yet established', async () => {
    expect((await detail(cases.find((x) => x.cs === 'SWA2816')!)).routeCheck).toContain('not on course for MDW');
    expect((await detail(cases.find((x) => x.cs === 'AAY83')!)).routeCheck).toContain('still within 150 km of its departure');
  });
});
