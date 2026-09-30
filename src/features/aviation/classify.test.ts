import { describe, expect, it } from 'vitest';
import { airlineCodeOf, classifyAircraft, emitterToOpenSky, isHelicopter, type ClassifyInput } from './classify';
import { normalizeAdsbResponse, normalizeAdsbRow, type AdsbResponse } from './adsb';
import point from './__fixtures__/adsblol-point-classify.json';

const base: ClassifyInput = { typeCode: null, callsign: null, dbFlags: null, categoryOs: null, altFt: null, gsKt: null };
const c = (p: Partial<ClassifyInput>) => classifyAircraft({ ...base, ...p });

describe('OSIRIS classifier (docs/reference/03 §1, rule order exactly)', () => {
  it.each([
    // rule 1: military
    [{ categoryOs: 14 }, 'military'],
    [{ dbFlags: 1 }, 'military'],
    [{ dbFlags: 9, typeCode: 'A320' }, 'military'], // bit 1 wins over an airliner type
    [{ typeCode: 'C17', callsign: 'BAW117' }, 'military'],
    [{ typeCode: 'eufi' }, 'military'], // types are upper-cased
    [{ callsign: 'RCH123' }, 'military'],
    [{ callsign: 'reach45' }, 'military'], // case-insensitive
    [{ callsign: 'KINGAIR' }, 'private'], // the callsign pattern needs a digit after the prefix
    // rule 2: commercial by type or heavy category
    [{ typeCode: 'B77W', callsign: 'N425RS' }, 'commercial'],
    [{ categoryOs: 4 }, 'commercial'],
    [{ categoryOs: 5 }, 'commercial'],
    [{ categoryOs: 6, callsign: 'GABCD' }, 'commercial'],
    // rule 3: jet
    [{ callsign: 'EJA512' }, 'jet'], // NetJets operator designator
    [{ typeCode: 'GLF6', callsign: 'N1' }, 'jet'],
    [{ categoryOs: 7 }, 'jet'],
    [{ callsign: 'N425RS', altFt: 41_000, gsKt: 450 }, 'jet'], // GA callsign cruising like a jet
    [{ callsign: 'N425RS', altFt: 27_000, gsKt: 450 }, 'private'], // 27 000 ft = 8 230 m ≤ 8 500 m
    [{ callsign: 'N425RS', altFt: 41_000, gsKt: 300 }, 'private'], // speed must exceed 300 kt
    // rule 4: private
    [{ callsign: 'DMMKG' }, 'private'],
    [{ categoryOs: 2 }, 'private'],
    // rule 5: default commercial
    [{ callsign: 'BAW117' }, 'commercial'],
    [{}, 'commercial'],
    [{ callsign: 'AB' }, 'commercial'], // too short for the GA callsign pattern
  ] as const)('%j → %s', (input, bucket) => {
    expect(c(input)).toBe(bucket);
  });

  it('parses the airline designator only from letters + digit', () => {
    expect(airlineCodeOf('BAW117')).toBe('BAW');
    expect(airlineCodeOf('N425RS')).toBeNull();
    expect(airlineCodeOf('GABCD')).toBeNull();
    expect(airlineCodeOf(null)).toBeNull();
  });

  it('maps ADS-B emitter categories onto OpenSky numbering', () => {
    expect(emitterToOpenSky('A1')).toBe(2);
    expect(emitterToOpenSky('A3')).toBe(4);
    expect(emitterToOpenSky('A5')).toBe(6);
    expect(emitterToOpenSky('A6')).toBe(7);
    expect(emitterToOpenSky('A7')).toBe(8);
    expect(emitterToOpenSky('B6')).toBe(14);
    expect(emitterToOpenSky('C1')).toBe(16);
    expect(emitterToOpenSky('A0')).toBe(1);
    expect(emitterToOpenSky('Z9')).toBeNull();
    expect(emitterToOpenSky(null)).toBeNull();
  });

  it('flags helicopters by type or rotorcraft category', () => {
    expect(isHelicopter('EC35', null)).toBe(true);
    expect(isHelicopter('h145', null)).toBe(true);
    expect(isHelicopter('B738', 8)).toBe(true);
    expect(isHelicopter('B738', 4)).toBe(false);
  });
});

/**
 * Real readsb rows (api.adsb.lol /v2/point/40.7/-74.0/250, captured 2026-09-30 22:43 UTC) and the
 * bucket OSIRIS's classifyFlight() gives the same row: readsb rows have no `category_os`, so the
 * emitter category never decides the bucket (R2-M1).
 */
describe('readsb rows classify exactly as OSIRIS does', () => {
  const expected: Record<string, [bucket: string, heli: boolean]> = {
    a6b151: ['jet', false], // N530KC GL5T A3 — typed business jet, not "commercial by A3"
    a25565: ['jet', false], // N25CP GLF5 A3
    ae10c1: ['military', false], // GLF5 dbFlags 1
    ab2899: ['jet', false], // N818RP E55P A2
    a03fc9: ['jet', false], // N115LJ LJ45 A2
    a3592e: ['private', false], // N3148S C182 A1
    a3af0e: ['private', false], // N3364S C210 A1
    a687af: ['commercial', false], // CSJ52 A1: designator callsign, no type rule → default
    ab60ee: ['commercial', false], // HRD32 SR20 A1
    aa9b65: ['commercial', false], // SWA4741 B737
    a55b50: ['commercial', false], // AAL3245 A21N (not in AIRLINER_TYPES) → default
    ac74dd: ['private', false], // N901WF H25B A6 at 5 025 ft: GA callsign, not cruising like a jet
    ae06e7: ['military', false], // SCORE03 BE20 dbFlags 1
    a0aef0: ['private', true], // N143MH EC35 A7
    a08edf: ['private', true], // N135MH EC35 A7
  };
  const batch = normalizeAdsbResponse(point as AdsbResponse, 'adsblol_tiles', 0);

  it('covers every captured row', () => {
    expect(batch.records.map((r) => r.id).sort()).toEqual(Object.keys(expected).sort());
  });

  it.each(Object.entries(expected))('%s → %j', (hex, [bucket, heli]) => {
    const r = batch.records.find((x) => x.id === hex)!;
    expect(r.bucket).toBe(bucket);
    expect(r.isHelicopter).toBe(heli);
  });

  it('R2 live examples: typed private jets under A3 are jets', () => {
    for (const [hex, reg, t] of [['a71329', 'N555MZ', 'GL7T'], ['a48e1f', 'N393BZ', 'GLEX'], ['a70e99', 'N554DG', 'GLF5']] as const) {
      const r = normalizeAdsbRow({ hex, flight: `${reg}  `, r: reg, t, category: 'A3', lat: 40, lon: -100, alt_baro: 45000, gs: 480, track: 90, seen_pos: 1 }, Date.now(), 'adsblol_tiles');
      expect(r.kind === 'ok' && r.record.bucket).toBe('jet');
    }
  });

  it('A1 / A6 / B6 emitter categories do not decide the bucket on readsb rows', () => {
    const row = (category: string, flight: string) => normalizeAdsbRow({ hex: 'abcdef', flight, category, lat: 1, lon: 1, alt_baro: 3000, gs: 120 }, 0, 'adsblol_tiles');
    expect(row('A1', 'CSJ52').kind === 'ok' && row('A1', 'CSJ52')).toMatchObject({ record: { bucket: 'commercial' } });
    expect(row('A6', 'SWA12')).toMatchObject({ record: { bucket: 'commercial' } });
    expect(row('B6', 'N12AB')).toMatchObject({ record: { bucket: 'private' } });
    expect(row('A3', 'N12AB')).toMatchObject({ record: { bucket: 'private' } });
  });
});
