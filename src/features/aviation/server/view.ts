/**
 * FlightsResponse body from a snapshot (columnar FLIGHT_FIELDS rows + `sources` + `counts`),
 * optionally filtered by bucket and bbox. Shared by /api/flights and /api/flights/stream.
 * Server-only.
 */
import 'server-only';
import { FLIGHT_FIELDS } from '@/lib/schemas/aviation';
import { inBBox } from '@/lib/geo';
import type { Cell } from '@/lib/columnar';
import type { FeedMeta, FreshnessState, Providers } from '@/lib/types';
import type { Bucket } from '../classify';
import { encodeFlight } from '../codec';
import type { FlightRecord } from '../adsb';
import { FLIGHT_SOURCES, type FlightsSnapshot } from './sweep';

export interface FlightsFilter {
  buckets?: ReadonlySet<Bucket> | null;
  /** [west, south, east, north]; west > east crosses the antimeridian. */
  bbox?: [number, number, number, number] | null;
}

export interface FlightsBody {
  fields: string[];
  rows: Cell[][];
  sources: string[];
  counts: { commercial: number; private: number; jet: number; military: number; total: number; noPosition: number };
}

const SRC_INDEX = new Map<string, number>(FLIGHT_SOURCES.map((s, i) => [s, i]));

export function selectRecords(snapshot: FlightsSnapshot, filter: FlightsFilter = {}): FlightRecord[] {
  return snapshot.records.filter(
    (r) => (!filter.buckets || filter.buckets.has(r.bucket)) && (!filter.bbox || inBBox([r.lng, r.lat], filter.bbox)),
  );
}

/** A failed positions provider whose last good data is older than this reads STALE (6 × the 60 s cadence). */
export const POSITIONS_STALE_AFTER_S = 360;

/**
 * The feed state the flights responses report (R2/R4 round 4): the generic feed state only knows
 * that a run completed (the global lists alone complete it), so it is capped by the POSITIONS
 * provider — the whole-network re-api when configured, else the keyless tile sweep. When that
 * provider is `ok: false` the snapshot is last-good data: never LIVE; RECENT while its age is
 * ≤ 360 s, else STALE. (The sweep already holds through one failed sweep period, so a single
 * 429 burst does not flip it.)
 */
export function flightsState(state: FreshnessState, providers: Providers): FreshnessState {
  if (state !== 'live' && state !== 'recent') return state;
  const primary = [providers.adsblol_reapi, providers.adsblol_tiles].find((p) => p && !p.skipped);
  if (!primary || primary.ok) return state;
  return primary.age_s !== null && primary.age_s <= POSITIONS_STALE_AFTER_S ? 'recent' : 'stale';
}

/** The feed result with `meta.state` capped by `flightsState()`. */
export function honestFlights<T extends { meta: FeedMeta; providers: Providers }>(r: T): T {
  const state = flightsState(r.meta.state, r.providers);
  return state === r.meta.state ? r : { ...r, meta: { ...r.meta, state } };
}

export function flightsBody(snapshot: FlightsSnapshot, filter: FlightsFilter = {}): FlightsBody {
  const records = selectRecords(snapshot, filter);
  const counts = { commercial: 0, private: 0, jet: 0, military: 0, total: records.length, noPosition: snapshot.noPosition.length };
  const rows: Cell[][] = new Array(records.length);
  for (let i = 0; i < records.length; i++) {
    const r = records[i]!;
    counts[r.bucket]++;
    rows[i] = encodeFlight(r, SRC_INDEX.get(r.source) ?? -1);
  }
  return { fields: [...FLIGHT_FIELDS], rows, sources: [...FLIGHT_SOURCES], counts };
}
