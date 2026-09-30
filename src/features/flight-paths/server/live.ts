/**
 * Live aircraft on an airport pair (GET /api/route/live, §8). Reads aviation's in-process flights
 * snapshot (never a second adsb.lol poller):
 *  - `matched`: the callsign is a VRS standing-data service for A→B (or B→A with reverse=1) and
 *    the aircraft is airborne inside the corridor (detour ≤ direct × 1.15 + 150 km);
 *  - `inferred`: no callsign match, but cross-track ≤ 100 km, track within ±35° of the local path
 *    bearing, above 8,000 ft, 2–98 % along, and inside the corridor.
 * Progress, remaining km and ETA (with the destination's UTC offset) per aircraft. Server-only.
 */
import 'server-only';
import type { z } from 'zod';
import type { LngLatTuple } from '@/lib/geo';
import type { LiveRouteAircraft } from '@/lib/schemas/flight-paths';
import type { FlightRecord } from '@/features/aviation/adsb';
import { corridorMatch, etaMs, onCorridor, progressOn } from '../lib/geometry';
import { localTimeIso } from '../lib/time';
import type { AirportRecord, VrsIndex } from './data';
import { icaoOf } from './plan';

export type LiveAircraft = z.infer<typeof LiveRouteAircraft>;
export const MAX_LIVE = 200;

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
  const out: LiveAircraft[] = [];
  for (const r of records) {
    if (r.onGround) continue;
    const p: LngLatTuple = [r.lng, r.lat];
    const state = { lat: r.lat, lng: r.lng, altFt: r.altFt, gsKt: r.gsKt, trackDeg: r.trackDeg, vrFpm: r.vrFpm };
    let direction: LiveAircraft['direction'] | null = null;
    let basis: LiveAircraft['basis'] = 'matched';
    if (r.callsign && fwd.has(r.callsign) && onCorridor(p, A, B)) direction = 'forward';
    else if (r.callsign && rev.has(r.callsign) && onCorridor(p, B, A)) direction = 'reverse';
    else if (corridorMatch(state, A, B)) [direction, basis] = ['forward', 'inferred'];
    else if (opts.reverse && corridorMatch(state, B, A)) [direction, basis] = ['reverse', 'inferred'];
    if (!direction) continue;
    const [from, to, dest] = direction === 'forward' ? [A, B, d] : [B, A, o];
    const { progress, remainingKm } = progressOn(p, from, to);
    const eta = etaMs(remainingKm, state, opts.now);
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
