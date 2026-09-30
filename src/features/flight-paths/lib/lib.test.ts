import { describe, expect, it } from 'vitest';
import { AirportWeather, LocalTime } from '@/lib/schemas';
import metarFixture from '../__fixtures__/awc-metar-EGLL-KJFK.json';
import tafFixture from '../__fixtures__/awc-taf-EGLL-KJFK.json';
import { localTimeIso, offsetDeltaHours, splitLocal, tzOffsetMinutes } from './time';
import { UpstreamBodyError, assertAwcArray, flightCategory, parseMetar, visibilityText, type AwcMetar, type AwcTaf } from './metar';
import { classifyIdent, normalizeIdent } from './idents';
import { METRO_GROUPS, metroFor } from './metro';
import { isPavedSurface } from './data-format';

// AWC fixtures recorded 2026-09-30T20:02Z (see `_captured`).
const metars = metarFixture.body as AwcMetar[];
const tafs = tafFixture.body as AwcTaf[];

describe('time', () => {
  const summer = Date.parse('2026-07-01T12:00:00Z');
  const winter = Date.parse('2026-01-15T12:00:00Z');
  it('offsets follow DST', () => {
    expect(tzOffsetMinutes('Europe/London', summer)).toBe(60);
    expect(tzOffsetMinutes('Europe/London', winter)).toBe(0);
    expect(tzOffsetMinutes('America/New_York', summer)).toBe(-240);
    expect(tzOffsetMinutes('America/New_York', winter)).toBe(-300);
    expect(tzOffsetMinutes('Asia/Kolkata', summer)).toBe(330);
    expect(tzOffsetMinutes('Not/AZone', summer)).toBeNull();
  });

  it('localTimeIso always carries the offset', () => {
    expect(localTimeIso('Europe/London', summer)).toBe('2026-07-01T13:00:00+01:00');
    expect(localTimeIso('America/New_York', winter)).toBe('2026-01-15T07:00:00-05:00');
    expect(localTimeIso('Asia/Kolkata', winter)).toBe('2026-01-15T17:30:00+05:30');
    expect(localTimeIso('Pacific/Chatham', winter)).toMatch(/\+13:45$/);
    expect(LocalTime.safeParse(localTimeIso('Asia/Tokyo', summer)).success).toBe(true);
    expect(localTimeIso(null, summer)).toBeNull();
    expect(localTimeIso('Nope/Nope', summer)).toBeNull();
  });

  it('offsetDeltaHours and splitLocal', () => {
    expect(offsetDeltaHours('Europe/London', 'America/New_York', summer)).toBe(-5);
    expect(offsetDeltaHours('Europe/London', 'Asia/Kolkata', winter)).toBe(5.5);
    expect(offsetDeltaHours(null, 'Asia/Kolkata', winter)).toBeNull();
    expect(offsetDeltaHours('Bad/Zone', 'Asia/Kolkata', winter)).toBeNull();
    expect(splitLocal('2026-07-01T13:05:00+01:00')).toEqual({ date: '2026-07-01', hhmm: '13:05', offset: '+01:00' });
    expect(splitLocal('2026-07-01T13:05:00Z').offset).toBe('+00:00');
    expect(splitLocal('garbage').offset).toBe('');
  });
});

describe('metar', () => {
  it('parses the recorded EGLL/KJFK reports with observation times', () => {
    const egll = parseMetar(metars.find((m) => m.icaoId === 'EGLL'), tafs.find((t) => t.icaoId === 'EGLL'));
    expect(AirportWeather.safeParse(egll).success).toBe(true);
    expect(egll.metar).toMatch(/^METAR EGLL/);
    expect(egll.taf).toMatch(/^TAF EGLL/);
    expect(egll.fltCat).toBe('VFR');
    expect(egll.observedAt).toBe(new Date(1790797800 * 1000).toISOString());
    expect(egll.visibility).toBe('6+');
    expect(egll.altimHpa).toBe(1014);
    expect(egll.clouds).toEqual([]);
    const kjfk = parseMetar(metars.find((m) => m.icaoId === 'KJFK'), undefined);
    expect(kjfk.clouds).toEqual([
      { cover: 'FEW', baseFt: 4200 },
      { cover: 'BKN', baseFt: 25000 },
    ]);
    expect(kjfk.taf).toBeNull();
    expect(kjfk.visibility).toBe('10+');
  });

  it('999999 sentinels and VRB winds become null; category derived when AWC omits it', () => {
    const w = parseMetar({ icaoId: 'XXXX', obsTime: 999999, temp: 999999, wdir: 'VRB', wspd: 3, visib: 0.5, clouds: [{ cover: 'OVC', base: 300 }] }, undefined);
    expect(w.observedAt).toBeNull();
    expect(w.tempC).toBeNull();
    expect(w.windDirDeg).toBeNull();
    expect(w.visibility).toBe('0.5');
    expect(w.fltCat).toBe('LIFR');
    expect(parseMetar(undefined, undefined).metar).toBeNull();
  });

  it('flightCategory thresholds', () => {
    expect(flightCategory(null, null)).toBeNull();
    expect(flightCategory(400, 10)).toBe('LIFR');
    expect(flightCategory(800, 10)).toBe('IFR');
    expect(flightCategory(2500, 10)).toBe('MVFR');
    expect(flightCategory(5000, 4)).toBe('MVFR');
    expect(flightCategory(5000, 2)).toBe('IFR');
    expect(flightCategory(null, 10)).toBe('VFR');
    expect(visibilityText(null)).toBeNull();
    expect(visibilityText(' ')).toBeNull();
  });

  it('an error object in a 200 body is a failure, not "no weather"', () => {
    expect(() => assertAwcArray({ error: { code: 429 } }, 'metar')).toThrow(UpstreamBodyError);
    expect(() => assertAwcArray({ error: 'quota' }, 'metar')).toThrow(/quota/);
    expect(() => assertAwcArray('<html>', 'metar')).toThrow(/unexpected/);
    expect(assertAwcArray(null, 'metar')).toEqual([]);
    expect(assertAwcArray([1], 'metar')).toEqual([1]);
  });
});

describe('idents', () => {
  it('classifies callsigns, IATA flight numbers, registrations and hex', () => {
    expect(classifyIdent('BAW117')[0]).toEqual({ kind: 'callsign', value: 'BAW117' });
    expect(classifyIdent('ba 117')[0]).toMatchObject({ kind: 'iata', airline: 'BA', number: '117' });
    expect(classifyIdent('U20012')[0]).toMatchObject({ kind: 'iata', airline: 'U2', number: '12' });
    expect(classifyIdent('G-XWBA')[0]).toEqual({ kind: 'registration', value: 'G-XWBA' });
    expect(classifyIdent('N12345').map((g) => g.kind)).toContain('registration');
    expect(classifyIdent('4ca2b3')[0]).toEqual({ kind: 'hex', value: '4ca2b3' });
    // ACA123 is both a callsign and valid hex: callsign first.
    expect(classifyIdent('ACA123').map((g) => g.kind)).toEqual(['callsign', 'hex']);
    expect(classifyIdent('!!')).toEqual([]);
    expect(normalizeIdent(' baw 117 ')).toBe('BAW117');
  });
});

describe('metro', () => {
  it('London, New York and Tokyo resolve to their groups', () => {
    expect(metroFor('London')?.airports).toEqual(['LHR', 'LGW', 'STN', 'LTN', 'LCY', 'SEN']);
    expect(metroFor('new york')?.airports).toEqual(['JFK', 'EWR', 'LGA']);
    expect(metroFor('NYC')?.code).toBe('NYC');
    expect(metroFor('Tokyo')?.airports).toEqual(['HND', 'NRT']);
    expect(metroFor('São Paulo')?.code).toBe('SAO');
    // A metro code that is also an airport code is the airport, not the group.
    expect(metroFor('SHA')).toBeNull();
    expect(metroFor('Heathrow')).toBeNull();
    expect(metroFor('')).toBeNull();
    for (const g of METRO_GROUPS) expect(g.airports.length).toBeGreaterThan(1);
  });

  it('paved surfaces', () => {
    expect(isPavedSurface('ASP')).toBe(true);
    expect(isPavedSurface('Concrete')).toBe(true);
    expect(isPavedSurface('GRS')).toBe(false);
    expect(isPavedSurface(null)).toBe(false);
  });
});
