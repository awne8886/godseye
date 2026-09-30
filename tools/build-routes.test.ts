import { describe, expect, it } from 'vitest';
import { buildOpenFlights, buildVrsIndex } from './build-routes';

// Rows copied from the VRS routes.csv and OpenFlights airlines.dat/routes.dat downloaded 2026-09-30.
describe('build-routes', () => {
  it('VRS chains group callsigns (multi-stop kept, junk dropped)', () => {
    const csv = '﻿Callsign,Code,Number,AirlineCode,AirportCodes\nBAW117,BAW,117,BAW,EGLL-KJFK\nAAL100,AAL,100,AAL,KJFK-EGLL\nBAW4LV,BAW,4LV,BAW,KLAS-EGLL\nQFA1,QFA,1,QFA,YSSY-WSSS-EGLL\nbad row,,,,\nXX1,XX,1,XX,EGLL\n';
    const idx = buildVrsIndex(csv, 'Sun, 20 Sep 2026 18:47:40 GMT', new Date('2026-09-30T20:00:00Z'));
    expect(idx.chains).toEqual({ 'EGLL-KJFK': ['BAW117'], 'KJFK-EGLL': ['AAL100'], 'KLAS-EGLL': ['BAW4LV'], 'YSSY-WSSS-EGLL': ['QFA1'] });
    expect(idx.licence).toBe('CC0-1.0');
    expect(() => buildVrsIndex('a,b\n1,2\n', null)).toThrow(/header/);
  });

  it('OpenFlights routes + airlines (active holder of a reused ICAO code wins)', () => {
    const airlines = '1355,"British Airways",\\N,"BA","BAW","SPEEDBIRD","United Kingdom","Y"\n9999,"Old BAW",\\N,"","BAW","","","N"\n24,"American Airlines",\\N,"AA","AAL","AMERICAN","United States","Y"\n';
    const routes = 'BA,1355,LHR,507,JFK,3797,,0,744 777\nAA,24,LHR,507,JFK,3797,Y,0,777\nBA,1355,LHR,507,\\N,\\N,,0,744\n';
    const of = buildOpenFlights(routes, airlines, new Date('2026-09-30T20:00:00Z'));
    expect(of.airlines.BAW).toEqual(['BA', 'British Airways', 'SPEEDBIRD', 'United Kingdom', 1]);
    expect(of.routes['LHR-JFK']).toEqual([
      ['British Airways', 0, 0, '744 777'],
      ['American Airlines', 1, 0, '777'],
    ]);
    expect(of.note).toMatch(/2014/);
  });
});

