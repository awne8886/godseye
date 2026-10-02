/**
 * OSIRIS's four-bucket aircraft classifier, rule for rule (docs/reference/03 §1,
 * ../reference/osiris src/app/api/flights/route.ts `classifyFlight`). Isomorphic and pure.
 *
 * OSIRIS reads the emitter category only as OpenSky's numeric `category_os` (extended=1), which
 * exists on OpenSky state vectors alone; on readsb rows (its adsb.fi source, our adsb.lol source)
 * the field is undefined and every `category_os` test is dead. To reproduce OSIRIS's result on the
 * same data, readsb rows are classified with `categoryOs: null` (adsb.ts) and only OpenSky rows pass
 * their numeric category. Note that OpenSky 14 is "UAV"; OSIRIS treats it as military, as does this port.
 */
import type { z } from 'zod';
import type { AircraftBucket } from '@/lib/schemas/aviation';

export type Bucket = z.infer<typeof AircraftBucket>;

export const HELI_TYPES: ReadonlySet<string> = new Set([
  'R22', 'R44', 'R66', 'B06', 'B06T', 'B204', 'B205', 'B206', 'B212', 'B222', 'B230',
  'B407', 'B412', 'B427', 'B429', 'B430', 'B505', 'B525',
  'AS32', 'AS35', 'AS50', 'AS55', 'AS65',
  'EC20', 'EC25', 'EC30', 'EC35', 'EC45', 'EC55', 'EC75',
  'H125', 'H130', 'H135', 'H145', 'H155', 'H160', 'H175', 'H215', 'H225',
  'S55', 'S58', 'S61', 'S64', 'S70', 'S76', 'S92',
  'A109', 'A119', 'A139', 'A169', 'A189', 'AW09',
  'MD52', 'MD60', 'MDHI', 'MD90', 'NOTR',
  'B47G', 'HUEY', 'GAMA', 'CABR', 'EXE',
]);

export const PRIVATE_JET_TYPES: ReadonlySet<string> = new Set([
  'G150', 'G200', 'G280', 'GLEX', 'G500', 'G550', 'G600', 'G650', 'G700',
  'GLF2', 'GLF3', 'GLF4', 'GLF5', 'GLF6', 'GL5T', 'GL7T', 'GV', 'GIV',
  'CL30', 'CL35', 'CL60', 'BD70', 'BD10',
  'C25A', 'C25B', 'C25C', 'C500', 'C510', 'C525', 'C550', 'C560', 'C56X', 'C680', 'C700', 'C750',
  'E35L', 'E50P', 'E55P', 'E545', 'E550',
  'FA50', 'FA7X', 'FA8X', 'F900', 'F2TH',
  'LJ35', 'LJ40', 'LJ45', 'LJ60', 'LJ70', 'LJ75',
  'PC12', 'PC24', 'TBM7', 'TBM8', 'TBM9',
  'PRM1', 'SF50', 'EA50', 'VLJ',
]);

export const MILITARY_INDICATORS: ReadonlySet<string> = new Set([
  'C17', 'C5M', 'C130', 'C30J', 'KC10', 'KC46', 'KC35', 'E3CF', 'E3TF', 'E8A',
  'B1B', 'B2', 'B52', 'F16', 'F15', 'F18', 'F22', 'F35', 'A10', 'F117',
  'RC135', 'E6B', 'P8A', 'P3', 'MQ9', 'RQ4', 'U2', 'EP3', 'RC12',
  'V22', 'CH47', 'UH60', 'AH64', 'AH1Z', 'MV22',
  'EUFI', 'RFAL', 'TORD', 'TYP', 'GR4',
]);

export const AIRLINER_TYPES: ReadonlySet<string> = new Set([
  'A319', 'A320', 'A321', 'A332', 'A333', 'A339', 'A343', 'A359', 'A388',
  'B737', 'B738', 'B739', 'B38M', 'B39M', 'B752', 'B753', 'B763', 'B764',
  'B772', 'B77L', 'B77W', 'B788', 'B789', 'B78X',
  'E170', 'E175', 'E190', 'E195', 'CRJ7', 'CRJ9', 'AT43', 'AT72', 'DH8D',
]);

/** Fractional-ownership / charter operators that file a 3-letter designator like an airline. */
export const BIZJET_OPERATORS: ReadonlySet<string> = new Set(['EJA', 'EJM', 'NJE', 'LXJ', 'FJO', 'VJT', 'XOJ', 'JTL', 'WUP', 'GAJ', 'DPJ', 'CLY', 'TWY']);

const AIRLINE_CODE_RE = /^([A-Z]{3})\d/;
/** A callsign that is not designator + number is a registration (GA): DMMKG, N425RS, CGABC. */
const CALLSIGN_RE = /^[A-Z0-9]{3,8}$/;
const MIL_CALLSIGN_RE = /^(RCH|KING|DUKE|EVAC|JAKE|REACH|CONVOY)\d/i;
const JET_CRUISE_ALT_M = 8500;
const JET_CRUISE_KTS = 300;
const FT_TO_M = 0.3048;

/** ADS-B emitter category (`A0`–`C7`) → OpenSky `category` number (same DO-260 field). */
export function emitterToOpenSky(category: string | null | undefined): number | null {
  if (!category || !/^[A-D][0-7]$/.test(category)) return null;
  const set = category[0]!;
  const n = Number(category[1]);
  if (set === 'A') return n === 0 ? 1 : n + 1; // A1 light = 2 … A5 heavy = 6, A6 high-perf = 7, A7 rotorcraft = 8
  if (set === 'B') return n === 0 ? 1 : n === 5 ? 13 : n + 8; // B1 glider = 9 … B4 ultralight = 12, B6 UAV = 14, B7 space = 15
  if (set === 'C') return n === 0 ? 1 : n <= 5 ? n + 15 : 13; // C1 emergency vehicle = 16 … C5 line obstacle = 20
  return 1;
}

/** 3-letter ICAO airline designator from a callsign (`BAW117` → `BAW`), else null. */
export function airlineCodeOf(callsign: string | null | undefined): string | null {
  const m = AIRLINE_CODE_RE.exec(callsign ?? '');
  return m ? m[1]! : null;
}

export interface ClassifyInput {
  /** ICAO type designator, any case. */
  typeCode: string | null;
  /** Trimmed callsign as broadcast (may be null). */
  callsign: string | null;
  /** readsb dbFlags (bit 1 = military). */
  dbFlags: number | null;
  /** OpenSky numeric emitter category (see emitterToOpenSky). */
  categoryOs: number | null;
  /** Barometric altitude in feet (null when unknown or on the ground). */
  altFt: number | null;
  gsKt: number | null;
}

/** OSIRIS rule order: military → commercial (typed/heavy) → jet → private → commercial default. */
export function classifyAircraft(f: ClassifyInput): Bucket {
  const model = (f.typeCode ?? '').toUpperCase();
  const flight = (f.callsign ?? '').trim().toUpperCase();
  const dbFlags = f.dbFlags ?? 0;
  const cat = f.categoryOs;
  const altMeters = typeof f.altFt === 'number' ? f.altFt * FT_TO_M : 0;
  const speedKnots = typeof f.gsKt === 'number' ? Math.round(f.gsKt * 10) / 10 : null;
  const airlineCode = airlineCodeOf(flight) ?? '';
  const isGaCallsign = !airlineCode && CALLSIGN_RE.test(flight);
  const cruisesLikeAJet = altMeters > JET_CRUISE_ALT_M && (speedKnots ?? 0) > JET_CRUISE_KTS;

  if (cat === 14 || dbFlags & 1 || MILITARY_INDICATORS.has(model) || MIL_CALLSIGN_RE.test(flight)) return 'military';
  if (AIRLINER_TYPES.has(model) || cat === 4 || cat === 5 || cat === 6) return 'commercial';
  if (BIZJET_OPERATORS.has(airlineCode) || PRIVATE_JET_TYPES.has(model) || cat === 7 || (isGaCallsign && cruisesLikeAJet)) return 'jet';
  if (isGaCallsign || cat === 2) return 'private';
  return 'commercial';
}

/** OSIRIS: `HELI_TYPES.has(t) || category_os === 8`. */
export function isHelicopter(typeCode: string | null, categoryOs: number | null): boolean {
  return HELI_TYPES.has((typeCode ?? '').toUpperCase()) || categoryOs === 8;
}

/** Private jets use the business-jet silhouette; so do military fast jets flagged by type. */
export const JET_SILHOUETTE_TYPES: ReadonlySet<string> = new Set([...PRIVATE_JET_TYPES, 'F16', 'F15', 'F18', 'F22', 'F35', 'A10', 'F117', 'EUFI', 'RFAL', 'TORD', 'TYP', 'GR4']);
