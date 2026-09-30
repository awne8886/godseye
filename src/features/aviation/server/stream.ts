/**
 * Flight deltas over SSE (§4 push feeds): one server-side loop pinned on globalThis fans out to
 * every client of /api/flights/stream. `snapshot` on connect (full FlightsResponse), then per feed
 * refresh an `update` with only the rows whose observation changed and a `status` with retired
 * ids, meta and providers; `heartbeat` every 15 s comes from the hub. Server-only.
 */
import 'server-only';
import { getHub, type SseHub } from '@/lib/sse';
import type { Cell } from '@/lib/columnar';
import { FLIGHT_FIELDS } from '@/lib/schemas/aviation';
import type { FeedResult } from '@/lib/feeds';
import { F } from '../codec';
import { flightsFeed } from '../feeds';
import type { FlightsSnapshot } from './sweep';
import { flightsBody } from './view';

const TICK_MS = 5_000;

interface StreamState {
  timer: ReturnType<typeof setInterval> | null;
  version: string | null;
  /** hex → seenAt last broadcast. */
  seen: Map<string, number>;
}

const G = globalThis as unknown as { __godseyeFlightStream?: StreamState };
const state: StreamState = (G.__godseyeFlightStream ??= { timer: null, version: null, seen: new Map() });

function snapshotPayload(result: FeedResult<FlightsSnapshot>) {
  if (result.data === null) return { error: 'source_offline', meta: result.meta, providers: result.providers };
  return { ...flightsBody(result.data), meta: result.meta, providers: result.providers };
}

export interface FlightDelta {
  rows: Cell[][];
  retired: string[];
}

/** Rows whose observation time changed since `seen`, and ids that left the snapshot. Updates `seen`. */
export function diffRows(rows: readonly Cell[][], seen: Map<string, number>): FlightDelta {
  const changed: Cell[][] = [];
  const present = new Set<string>();
  for (const row of rows) {
    const id = row[F.id] as string;
    const at = row[F.seenAt] as number;
    present.add(id);
    if (seen.get(id) !== at) {
      changed.push(row);
      seen.set(id, at);
    }
  }
  const retired: string[] = [];
  for (const id of seen.keys()) if (!present.has(id)) retired.push(id);
  for (const id of retired) seen.delete(id);
  return { rows: changed, retired };
}

function tick(hub: SseHub) {
  if (hub.size === 0) {
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
    state.version = null;
    state.seen.clear();
    return;
  }
  // Reading keeps the feed's poll loop alive while anyone is subscribed.
  void flightsFeed.get().then((result) => {
    const version = `${result.meta.fetchedAt}|${result.meta.state}`;
    if (version === state.version) return;
    state.version = version;
    if (result.data === null) {
      hub.broadcast('status', { retired: [], meta: result.meta, providers: result.providers });
      return;
    }
    const body = flightsBody(result.data);
    const delta = diffRows(body.rows, state.seen);
    if (delta.rows.length) hub.broadcast('update', { fields: [...FLIGHT_FIELDS], rows: delta.rows, sources: body.sources, counts: body.counts });
    hub.broadcast('status', { retired: delta.retired, meta: result.meta, providers: result.providers });
  });
}

/**
 * Per-client SSE buffer for /api/flights/stream (SEC-m7): room for exactly one connect snapshot
 * plus one delta, sized from the aircraft count. Measured 2026-09-30: 9.5k rows = 0.50–1.1 MB of
 * JSON (~116 B/row); 160 B/row leaves headroom for long callsigns/registrations. Clamped to
 * 1–4 MB (4 MB is the bulk-response cap), so the worst case per slow consumer is 4 MB, not 8 MB,
 * and the lead's process-wide SSE budget (src/lib/sse.ts) still applies on top.
 */
export const STREAM_BYTES_PER_ROW = 160;
export const STREAM_BUFFER_MIN = 1024 * 1024;
export const STREAM_BUFFER_MAX = 4 * 1024 * 1024;
export function streamBufferBytes(aircraft: number): number {
  const need = Math.ceil(aircraft * STREAM_BYTES_PER_ROW * 1.25) + 64 * 1024;
  return Math.min(STREAM_BUFFER_MAX, Math.max(STREAM_BUFFER_MIN, need));
}

export function flightsHub(): SseHub {
  const hub = getHub('flights', () => snapshotPayload(flightsFeed.peek()));
  if (!state.timer) {
    const peek = flightsFeed.peek();
    state.version = `${peek.meta.fetchedAt}|${peek.meta.state}`;
    state.seen = new Map(peek.data?.records.map((r) => [r.id, r.seenAt]) ?? []);
    state.timer = setInterval(() => tick(hub), TICK_MS);
    state.timer.unref?.();
  }
  return hub;
}
