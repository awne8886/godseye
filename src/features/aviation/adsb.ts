/**
 * readsb / ADSBexchange-v2 ("jv2") aircraft rows → GODSEYE flight records, and the merge of
 * several providers into one set. Used for adsb.lol `/v2/*`, adsb.lol re-api `&jv2` and adsb.fi
 * v3 (all the same shape). Pure and isomorphic; the fetching lives in server/providers.ts.
 *
 * Upstream quirks encoded here (probed 2026-09-30, docs/data-sources/layers-aviation.md):
 *  - `flight` is space-padded to 8 chars (`"RYR19WT "`): trim + upper-case before any matching.
 *  - `alt_baro` is a number of feet or the string `"ground"`.
 *  - `emergency` is `"none"` when there is none; `squawk` 7500/7600/7700 are the emergency codes.
 *  - `/v2/mil` and `/v2/ladd` include aircraft WITHOUT `lat`/`lon` (only `lastPosition` or
 *    `rr_lat`/`rr_lon` rough receiver guesses): they are counted as `noPosition`, never drawn.
 *  - `seen_pos` is seconds since the position was received, relative to the response's `now` (ms).
 */
import { airlineCodeOf, classifyAircraft, isHelicopter, type Bucket } from './classify';

/** The subset of a readsb jv2 aircraft object that GODSEYE reads. */
export interface AdsbRow {
  hex?: string;
  type?: string;
  flight?: string;
  r?: string;
  t?: string;
  dbFlags?: number;
  alt_baro?: number | 'ground' | string;
  alt_geom?: number;
  gs?: number;
  track?: number;
  true_heading?: number;
  baro_rate?: number;
  geom_rate?: number;
  squawk?: string;
  emergency?: string;
  category?: string;
  lat?: number;
  lon?: number;
  nac_p?: number;
  seen_pos?: number;
  seen?: number;
  mlat?: unknown[];
  tisb?: unknown[];
}

export interface AdsbResponse {
  ac?: AdsbRow[];
  now?: number;
  total?: number;
  msg?: string;
}

/** One aircraft as GODSEYE stores it server-side (also the decoded client shape). */
export interface FlightRecord {
  id: string;
  callsign: string | null;
  registration: string | null;
  typeCode: string | null;
  bucket: Bucket;
  isHelicopter: boolean;
  onGround: boolean;
  lat: number;
  lng: number;
  altFt: number | null;
  altGeomFt: number | null;
  gsKt: number | null;
  trackDeg: number | null;
  vrFpm: number | null;
  squawk: string | null;
  emergency: '7500' | '7600' | '7700' | null;
  category: string | null;
  nacP: number | null;
  dbFlags: number | null;
  /** Epoch SECONDS of the position observation. */
  seenAt: number;
  /** Provider key that supplied this record. */
  source: string;
  posSource: 'adsb' | 'mlat' | 'tisb' | 'adsr' | 'other' | null;
}

const HEX_RE = /^~?[0-9a-f]{6}$/;
const CALLSIGN_RE = /^[A-Z0-9]{2,8}$/;
const SQUAWK_RE = /^[0-7]{4}$/;
const EMERGENCY_SQUAWKS = new Set(['7500', '7600', '7700']);

const round = (v: number, dp: number) => {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Trimmed, upper-case callsign or null (adsb.lol pads with spaces; `@@@@@@@@` means none). */
export function cleanCallsign(flight: string | null | undefined): string | null {
  const cs = (flight ?? '').trim().toUpperCase();
  return CALLSIGN_RE.test(cs) ? cs : null;
}

/** The callsign as OSIRIS's classifier reads it: trimmed and upper-cased, no validity filter. */
function rawCallsign(flight: string | null | undefined): string | null {
  return (flight ?? '').trim().toUpperCase() || null;
}

export function emergencyOf(squawk: string | null): FlightRecord['emergency'] {
  return squawk && EMERGENCY_SQUAWKS.has(squawk) ? (squawk as FlightRecord['emergency']) : null;
}

/** readsb `type` → position source. MLAT/TIS-B positions are less precise; the card says so. */
export function posSourceOf(row: Pick<AdsbRow, 'type' | 'mlat' | 'tisb'>): FlightRecord['posSource'] {
  const t = row.type ?? '';
  if (t.startsWith('adsb')) return 'adsb';
  if (t === 'mlat' || (Array.isArray(row.mlat) && row.mlat.includes('lat'))) return 'mlat';
  if (t.startsWith('tisb') || (Array.isArray(row.tisb) && row.tisb.includes('lat'))) return 'tisb';
  if (t.startsWith('adsr')) return 'adsr';
  return t ? 'other' : null;
}

export type NormalizeResult = { kind: 'ok'; record: FlightRecord } | { kind: 'no-position'; id: string } | { kind: 'skip' };

/**
 * Normalise one row. `nowMs` is the response's `now` (upstream clock) so `seenAt` is the
 * upstream's observation time, never our fetch time.
 */
export function normalizeAdsbRow(row: AdsbRow, nowMs: number, source: string): NormalizeResult {
  const id = (row.hex ?? '').trim().toLowerCase();
  if (!HEX_RE.test(id)) return { kind: 'skip' };
  const typeCode = row.t?.trim().toUpperCase() || null;
  if (typeCode === 'TWR') return { kind: 'skip' }; // ground stations (OSIRIS rule)
  const lat = num(row.lat);
  const lng = num(row.lon);
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return { kind: 'no-position', id };

  const onGround = row.alt_baro === 'ground';
  const altFt = num(row.alt_baro);
  const gsKt = num(row.gs);
  const track = num(row.track) ?? num(row.true_heading);
  const squawkRaw = row.squawk?.trim() ?? '';
  const squawk = SQUAWK_RE.test(squawkRaw) ? squawkRaw : null;
  const category = row.category && /^[A-D][0-7]$/.test(row.category) ? row.category : null;
  const callsign = cleanCallsign(row.flight);
  const dbFlags = num(row.dbFlags);
  const seenPos = num(row.seen_pos) ?? num(row.seen) ?? 0;
  const nacP = num(row.nac_p);

  return {
    kind: 'ok',
    record: {
      id,
      callsign,
      registration: row.r?.trim() || null,
      typeCode,
      // OSIRIS's `category_os` tests only ever fire on OpenSky state vectors: readsb rows carry no
      // `category_os`, so on this data its classifier runs on type, callsign, dbFlags and speed alone.
      // Feeding the readsb emitter category in would move typed business jets (A3) to commercial.
      // The classifier sees the callsign exactly as OSIRIS does (trimmed, upper-cased, unfiltered).
      bucket: classifyAircraft({ typeCode, callsign: rawCallsign(row.flight), dbFlags, categoryOs: null, altFt, gsKt }),
      // Icon only (not a bucket rule): a rotorcraft emitter category (A7) draws the helicopter silhouette.
      isHelicopter: isHelicopter(typeCode, category === 'A7' ? 8 : null),
      onGround,
      lat: round(lat, 5),
      lng: round(lng, 5),
      altFt,
      altGeomFt: num(row.alt_geom),
      gsKt: gsKt === null ? null : Math.max(0, round(gsKt, 1)),
      trackDeg: track === null ? null : round(((track % 360) + 360) % 360, 1) % 360,
      vrFpm: num(row.baro_rate) ?? num(row.geom_rate),
      squawk,
      emergency: emergencyOf(squawk),
      category,
      nacP: nacP !== null && Number.isInteger(nacP) && nacP >= 0 && nacP <= 11 ? nacP : null,
      dbFlags: dbFlags !== null && Number.isInteger(dbFlags) && dbFlags >= 0 ? dbFlags : null,
      seenAt: Math.round((nowMs - seenPos * 1000) / 1000),
      source,
      posSource: posSourceOf(row),
    },
  };
}

export interface NormalizedBatch {
  records: FlightRecord[];
  /** Hex ids reported without a position. */
  noPosition: string[];
}

export function normalizeAdsbResponse(body: AdsbResponse | undefined, source: string, fallbackNowMs: number): NormalizedBatch {
  const nowMs = num(body?.now) ?? fallbackNowMs;
  const records: FlightRecord[] = [];
  const noPosition: string[] = [];
  for (const row of body?.ac ?? []) {
    const r = normalizeAdsbRow(row, nowMs, source);
    if (r.kind === 'ok') records.push(r.record);
    else if (r.kind === 'no-position') noPosition.push(r.id);
  }
  return { records, noPosition };
}

/**
 * Merge records by hex, keeping the newest position (`seenAt`). On a tie the earlier list wins,
 * so callers pass the most specific provider first. dbFlags from any provider are OR-ed in, so a
 * /v2/mil or /v2/ladd membership is kept even when a tile row carried the position.
 */
export function mergeRecords(lists: readonly (readonly FlightRecord[])[]): Map<string, FlightRecord> {
  const out = new Map<string, FlightRecord>();
  for (const list of lists) {
    for (const r of list) {
      const prev = out.get(r.id);
      if (!prev) {
        out.set(r.id, r);
        continue;
      }
      const flags = prev.dbFlags !== null || r.dbFlags !== null ? (prev.dbFlags ?? 0) | (r.dbFlags ?? 0) : null;
      const winner = r.seenAt > prev.seenAt ? r : prev;
      if (flags === winner.dbFlags) {
        out.set(r.id, winner);
      } else {
        // The only classifier input dbFlags feed is bit 1 (military, rule 1); every other rule is
        // unchanged, so the winner's own bucket stands unless the merged flags add that bit.
        out.set(r.id, { ...winner, dbFlags: flags, bucket: flags !== null && flags & 1 ? 'military' : winner.bucket });
      }
    }
  }
  return out;
}

export { airlineCodeOf };
