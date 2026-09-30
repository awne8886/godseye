import { describe, expect, it } from 'vitest';
import { airlineCodeOf, classifyAircraft, emitterToOpenSky, isHelicopter, type ClassifyInput } from './classify';

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
