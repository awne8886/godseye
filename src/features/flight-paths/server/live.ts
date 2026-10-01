/**
 * Live aircraft on an airport pair (GET /api/route/live, §8). Reads aviation's in-process flights
 * snapshot (never a second adsb.lol poller):
 *  - `matched`: the callsign is a VRS standing-data service on the pair (either way) and the
 *    aircraft is airborne inside the corridor (detour ≤ direct × 1.15 + 150 km) with an observed
 *    direction (`headingAlong`): flying A→B → forward; flying B→A → reverse, only with reverse=1
 *    (round 3 M1: a DFW→JFK service seen inbound to DFW is never a forward DFW→JFK aircraft). A
 *    service listed A→B only, seen flying B→A, is listed as reverse only when it is consistent with
 *    that unlisted leg (`reverseLegReject`, round 5 B1: SWA2331, a LIT→LAS service flying SE 600 km
 *    off the great circle toward Laredo, was "MATCHED reverse" with an ETA at LIT);
 *  - `inferred` (R2-M2): no callsign match AND no known route elsewhere (a VRS route for the
 *    callsign that is not this pair rejects it), not military / business / private / helicopter,
 *    not an all-cargo operator, not a short-range type on a long route; then the geometric
 *    corridor test (`corridorReject`: ≤ 100 km off the great circle, track within ±20° of the
 *    local bearing, cruise altitude for the route length, ≥ 400 km from both endpoints, 5–95 %).
 * Progress, remaining km and ETA (with the destination's UTC offset) per aircraft. Server-only.
 */
import 'server-only';
import type { z } from 'zod';
import type { LngLatTuple } from '@/lib/geo';
import type { LiveRouteAircraft } from '@/lib/schemas/flight-paths';
import type { FeedMeta, ProviderStatus } from '@/lib/types';
import type { FlightRecord } from '@/features/aviation/adsb';
import type { FlightsSnapshot } from '@/features/aviation/server/sweep';
import { distanceKm } from '@/lib/geo';
import { airlineCodeOf } from '@/features/aviation/classify';
import { corridorReject, etaMs, flyingRoute, progressOn, reverseLegReject } from '../lib/geometry';
import { localTimeIso } from '../lib/time';
import type { AirportRecord, VrsIndex } from './data';
import { icaoOf } from './plan';

export type LiveAircraft = z.infer<typeof LiveRouteAircraft>;
export const MAX_LIVE = 200;

/**
 * All-cargo operators (ICAO airline designators). Their flights are not passenger services on the
 * pair a planner asks about; without a VRS match they are never inferred.
 */
export const CARGO_OPERATORS: ReadonlySet<string> = new Set(['ABW', 'ABX', 'ATN', 'BCS', 'BOX', 'CAO', 'CKK', 'CKS', 'CLX', 'DHK', 'DHX', 'FDX', 'GEC', 'GTI', 'MPH', 'NCR', 'PAC', 'UPS']);

/**
 * ICAO type designators of regional jets and turboprops: never inferred on a route longer than
 * `SHORT_RANGE_MAX_KM` — near a long-haul path they are domestic/regional legs crossing it.
 */
export const SHORT_RANGE_TYPES: ReadonlySet<string> = new Set([
  'AT43', 'AT45', 'AT46', 'AT72', 'AT73', 'AT75', 'AT76', 'B190', 'CRJ1', 'CRJ2', 'CRJ7', 'CRJ9', 'CRJX', 'D328', 'DH8A', 'DH8B',
  'DH8C', 'DH8D', 'E135', 'E145', 'E170', 'E75L', 'E75S', 'E190', 'E195', 'E290', 'E295', 'F100', 'F70', 'J328', 'JS41', 'SF34', 'SB20',
]);
export const SHORT_RANGE_MAX_KM = 3_500;

export type InferReject = 'known-route' | 'category' | 'no-airline-callsign' | 'cargo' | 'short-range-type' | NonNullable<ReturnType<typeof corridorReject>>;

/**
 * Why a record without a callsign match is NOT inferred onto a→b (null = inferred). `knownChain`
 * is the callsign's own VRS route (ICAO stops in order), when it has one: a known route that does
 * not fly a then b rejects the aircraft outright.
 */
export function inferReject(r: FlightRecord, a: LngLatTuple, b: LngLatTuple, aIcao: string | null, bIcao: string | null, knownChain: readonly string[] | undefined): InferReject | null {
  if (knownChain) {
    const i = aIcao ? knownChain.indexOf(aIcao) : -1;
    const j = bIcao ? knownChain.lastIndexOf(bIcao) : -1;
    if (!(i >= 0 && j > i)) return 'known-route';
  }
  if (r.isHelicopter || r.bucket !== 'commercial' || (r.dbFlags ?? 0) & 1) return 'category';
  // Scheduled services fly airline callsigns (3-letter ICAO designator + flight number).
  const op = airlineCodeOf(r.callsign);
  if (!op) return 'no-airline-callsign';
  if (CARGO_OPERATORS.has(op)) return 'cargo';
  if (r.typeCode && SHORT_RANGE_TYPES.has(r.typeCode) && distanceKm(a, b) > SHORT_RANGE_MAX_KM) return 'short-range-type';
  return corridorReject({ lat: r.lat, lng: r.lng, altFt: r.altFt, gsKt: r.gsKt, trackDeg: r.trackDeg, vrFpm: r.vrFpm }, a, b);
}

export function aircraftOnRoute(
  records: readonly FlightRecord[],
  o: AirportRecord,
  d: AirportRecord,
  opts: { reverse: boolean; now: number; vrs: VrsIndex },
): LiveAircraft[] {
  const A: LngLatTuple = [o.lng, o.lat];
  const B: LngLatTuple = [d.lng, d.lat];
  const a = icaoOf(o);
  const b = icaoOf(d);
  const fwd = new Set(a && b ? (opts.vrs.byPair.get(`${a}-${b}`) ?? []) : []);
  const rev = new Set(a && b && opts.reverse ? (opts.vrs.byPair.get(`${b}-${a}`) ?? []) : []);
  // Field elevations: the terminal rules compare the height above each end (round 5 M1).
  const elevAB = { a: o.elevationFt, b: d.elevationFt };
  const elevBA = { a: d.elevationFt, b: o.elevationFt };
  const out: LiveAircraft[] = [];
  for (const r of records) {
    if (r.onGround) continue;
    const p: LngLatTuple = [r.lng, r.lat];
    const state = { lat: r.lat, lng: r.lng, altFt: r.altFt, gsKt: r.gsKt, trackDeg: r.trackDeg, vrFpm: r.vrFpm };
    let direction: LiveAircraft['direction'] | null = null;
    let basis: LiveAircraft['basis'] = 'matched';
    // MATCHED needs the callsign AND the observed direction (M1): a forward service seen flying
    // B→A is the reverse leg — counted there only when the reverse toggle is on, never forward.
    const isFwd = !!r.callsign && fwd.has(r.callsign);
    const isRev = !!r.callsign && rev.has(r.callsign);
    if ((isFwd || isRev) && flyingRoute(state, A, B, elevAB)) {
      if (isFwd) direction = 'forward';
    } else if ((isFwd || isRev) && opts.reverse && flyingRoute(state, B, A, elevBA)) {
      // Listed B→A: standing data. Listed A→B only: an unlisted reverse leg, shown only when the
      // observation fits it (no trace here: the present position and course).
      if (isRev || reverseLegReject(state, B, A, [], { from: d.elevationFt, to: o.elevationFt }) === null) direction = 'reverse';
      else continue;
    } else if (isFwd || isRev) {
      continue;
    } else {
      const known = r.callsign ? opts.vrs.chainOf.get(r.callsign) : undefined;
      if (inferReject(r, A, B, a, b, known) === null) [direction, basis] = ['forward', 'inferred'];
      else if (opts.reverse && inferReject(r, B, A, b, a, known) === null) [direction, basis] = ['reverse', 'inferred'];
    }
    if (!direction) continue;
    const [from, to, dest] = direction === 'forward' ? [A, B, d] : [B, A, o];
    const { progress, remainingKm } = progressOn(p, from, to);
    // From the observation time, not the request (round 4 m1).
    const eta = etaMs(remainingKm, state, r.seenAt * 1000);
    out.push({
      hex: r.id,
      callsign: r.callsign,
      lat: r.lat,
      lng: r.lng,
      altFt: r.altFt,
      gsKt: r.gsKt,
      trackDeg: r.trackDeg,
      direction,
      basis,
      progress,
      remainingKm,
      eta: eta !== null ? new Date(eta).toISOString() : null,
      etaLocal: eta !== null ? localTimeIso(dest.tz, eta) : null,
      etaTz: dest.tz,
      observedAt: new Date(r.seenAt * 1000).toISOString(),
    });
  }
  return out
    .sort((x, y) => (x.direction === y.direction ? 0 : x.direction === 'forward' ? -1 : 1) || (x.basis === y.basis ? 0 : x.basis === 'matched' ? -1 : 1) || y.progress - x.progress)
    .slice(0, MAX_LIVE);
}

/**
 * How much of the tile sweep the snapshot holds (round 3 m4: the first sweep after a start had
 * 232 tiles of rows and was answered as a complete LIVE picture). Undefined without tile state.
 */
export function tileCoverage(snap: Pick<FlightsSnapshot, 'tiles'>): { tilesRead: number; tilesTotal: number; complete: boolean } | undefined {
  const tiles = snap.tiles;
  if (!Array.isArray(tiles) || !tiles.length) return undefined;
  const tilesRead = tiles.filter((t) => t.ok && t.at !== null).length;
  return { tilesRead, tilesTotal: tiles.length, complete: tilesRead === tiles.length };
}

/**
 * The feed meta /api/route/live reports (round 4 #8: it said `state: "live"` with `stale: true`
 * while the adsb.lol tile sweep that supplies these positions answered 429). The flights feed's
 * state, made consistent with what it serves:
 *  - the tile sweep failing (its latest response an error, not a skip) → at most `stale`: the rows
 *    are last-good positions, each with its own `observedAt`;
 *  - the snapshot served past its TTL (`stale: true`) → never `live`;
 *  - `stale` is true whenever the state is `stale` or `offline`.
 */
export function liveRouteMeta(meta: FeedMeta, tiles: ProviderStatus | undefined): FeedMeta {
  const failing = !!tiles && !tiles.ok && !tiles.skipped;
  let state = meta.state;
  if (failing && (state === 'live' || state === 'recent')) state = 'stale';
  else if (meta.stale && state === 'live') state = 'recent';
  return { ...meta, state, stale: meta.stale || state === 'stale' || state === 'offline' };
}
