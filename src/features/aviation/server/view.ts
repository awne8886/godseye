/**
 * FlightsResponse body from a snapshot (columnar FLIGHT_FIELDS rows + `sources` + `counts`),
 * optionally filtered by bucket and bbox. Shared by /api/flights and /api/flights/stream.
 * Server-only.
 */
import 'server-only';
import { FLIGHT_FIELDS } from '@/lib/schemas/aviation';
import { inBBox } from '@/lib/geo';
import type { Cell } from '@/lib/columnar';
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
