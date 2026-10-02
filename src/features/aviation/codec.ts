/**
 * Compact FLIGHT_FIELDS rows (src/lib/schemas/aviation.ts) and dead-reckoning. Isomorphic.
 * Row cells: `bucket` = index into AircraftBucket.options, `isHelicopter`/`onGround` = 0|1,
 * `seenAt` = epoch SECONDS of the position, `src` = index into the response's `sources`.
 */
import { AircraftBucket, FLIGHT_FIELDS } from '@/lib/schemas/aviation';
import { destination } from '@/lib/geo';
import { fieldIndex, type Cell } from '@/lib/columnar';
import type { Bucket } from './classify';
import { emergencyOf, type FlightRecord } from './adsb';

export const BUCKETS = AircraftBucket.options;
export const F = fieldIndex(FLIGHT_FIELDS);

export function encodeFlight(r: FlightRecord, srcIndex: number): Cell[] {
  const row: Cell[] = new Array(FLIGHT_FIELDS.length);
  row[F.id] = r.id;
  row[F.callsign] = r.callsign;
  row[F.registration] = r.registration;
  row[F.typeCode] = r.typeCode;
  row[F.bucket] = BUCKETS.indexOf(r.bucket);
  row[F.isHelicopter] = r.isHelicopter ? 1 : 0;
  row[F.onGround] = r.onGround ? 1 : 0;
  row[F.lat] = r.lat;
  row[F.lng] = r.lng;
  row[F.altFt] = r.altFt;
  row[F.altGeomFt] = r.altGeomFt;
  row[F.gsKt] = r.gsKt;
  row[F.trackDeg] = r.trackDeg;
  row[F.vrFpm] = r.vrFpm;
  row[F.squawk] = r.squawk;
  row[F.category] = r.category;
  row[F.nacP] = r.nacP;
  row[F.dbFlags] = r.dbFlags;
  row[F.seenAt] = r.seenAt;
  row[F.src] = srcIndex;
  return row;
}

const str = (c: Cell | undefined): string | null => (typeof c === 'string' ? c : null);
const nm = (c: Cell | undefined): number | null => (typeof c === 'number' && Number.isFinite(c) ? c : null);

/** Decode one row (client side). Unknown `src` indices decode to `unknown`. */
export function decodeFlight(row: readonly Cell[], sources: readonly string[]): FlightRecord | null {
  const id = str(row[F.id]);
  const lat = nm(row[F.lat]);
  const lng = nm(row[F.lng]);
  const seenAt = nm(row[F.seenAt]);
  if (!id || lat === null || lng === null || seenAt === null) return null;
  const squawk = str(row[F.squawk]);
  const bucket: Bucket = BUCKETS[nm(row[F.bucket]) ?? 0] ?? 'commercial';
  return {
    id,
    callsign: str(row[F.callsign]),
    registration: str(row[F.registration]),
    typeCode: str(row[F.typeCode]),
    bucket,
    isHelicopter: row[F.isHelicopter] === 1,
    onGround: row[F.onGround] === 1,
    lat,
    lng,
    altFt: nm(row[F.altFt]),
    altGeomFt: nm(row[F.altGeomFt]),
    gsKt: nm(row[F.gsKt]),
    trackDeg: nm(row[F.trackDeg]),
    vrFpm: nm(row[F.vrFpm]),
    squawk,
    emergency: emergencyOf(squawk),
    category: str(row[F.category]),
    nacP: nm(row[F.nacP]),
    dbFlags: nm(row[F.dbFlags]),
    seenAt,
    source: sources[nm(row[F.src]) ?? -1] ?? 'unknown',
    posSource: null,
  };
}

/** §0: dead-reckoning between polls only from the aircraft's own track/speed, at most 60 s. */
export const MAX_DEAD_RECKON_S = 60;
const KT_TO_KMS = 1.852 / 3600;

export interface Reckoned {
  lng: number;
  lat: number;
  /** Seconds extrapolated (0 when not moving or no track/speed). */
  extrapolatedS: number;
  /** True once the 60 s cap is reached: the icon freezes and is drawn as stale. */
  frozen: boolean;
}

/**
 * Position at `nowMs` extrapolated along the reported track at the reported ground speed, capped at
 * MAX_DEAD_RECKON_S after the observation. Aircraft on the ground, or without a track or speed,
 * stay at their observed position.
 */
export function deadReckon(
  a: Pick<FlightRecord, 'lat' | 'lng' | 'gsKt' | 'trackDeg' | 'onGround' | 'seenAt'>,
  nowMs: number,
): Reckoned {
  const age = Math.max(0, nowMs / 1000 - a.seenAt);
  const frozen = age > MAX_DEAD_RECKON_S;
  if (a.onGround || a.gsKt === null || a.trackDeg === null || a.gsKt <= 0) return { lng: a.lng, lat: a.lat, extrapolatedS: 0, frozen };
  const dt = Math.min(age, MAX_DEAD_RECKON_S);
  const [lng, lat] = destination([a.lng, a.lat], a.trackDeg, a.gsKt * KT_TO_KMS * dt);
  return { lng, lat, extrapolatedS: dt, frozen };
}
