/**
 * GPS interference: gpsjam.org daily H3 (resolution 4) aggregates plus optional live NACp binning
 * from the in-process flights feed. Owner: layers-hazards. Server-only.
 *
 * Probed 2026-09-30: `data/manifest.csv` (date,suspect,num_bad_aircraft_hexes,source; gzip) 200 in
 * 0.99 s; `data/2026-09-29-h3_4.csv` (hex,count_good_aircraft,count_bad_aircraft) 200 in 0.98 s,
 * 47 846 cells of which 3 047 had bad > 0. No CORS header, so the browser never calls it.
 * Licence: none stated by gpsjam.org → attributed ("GPS interference data: gpsjam.org, John
 * Wiseman; licence unstated") and noted in meta.
 */
import 'server-only';
import { cellToLatLng, isValidCell, latLngToCell } from 'h3-js';
import { csvRows } from '@/lib/csv';
import { getFeed, runProvider, type ProviderRun } from '@/lib/feeds';
import { httpText } from '@/lib/http';
import type { GpsJamCell } from '@/lib/types';
import { lookup } from './lookup';

export const GPSJAM_BASE = 'https://gpsjam.org/data/';
export const MAX_JAM_CELLS = 30_000;
/** Live binning thresholds (contract §6): NACp ≤ 4 counts as degraded; ≥ 3 aircraft per cell. */
export const LIVE_BAD_NACP = 4;
export const LIVE_MIN_AIRCRAFT = 3;
/**
 * Live positions older than this (or of unknown age) are not binned: a "live" interference cell
 * must describe the last minute, not the 300 s aviation prune window.
 */
export const LIVE_MAX_POSITION_AGE_S = 60;

export const GPSJAM_ATTRIBUTION = [
  { text: 'GPS interference data: gpsjam.org (John Wiseman), derived from ADS-B Exchange/adsb.lol NACp reports', url: 'https://gpsjam.org/', licence: 'Licence unstated by gpsjam.org; attributed' },
];

export interface ManifestRow {
  date: string;
  suspect: boolean | null;
}

export function parseManifest(text: string): ManifestRow[] {
  const it = csvRows(text);
  const head = it.next();
  if (head.done) return [];
  const h = head.value.map((x) => x.trim().toLowerCase());
  const iDate = h.indexOf('date');
  const iSus = h.indexOf('suspect');
  const out: ManifestRow[] = [];
  for (const r of it) {
    const date = (r[iDate] ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const s = (r[iSus] ?? '').trim().toLowerCase();
    out.push({ date, suspect: s === 'true' ? true : s === 'false' ? false : null });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * gpsjam's published share of degraded aircraft (https://gpsjam.org/faq, probed 2026-10-01):
 * `percent_bad_aircraft = 100 * (num_bad_aircraft - 1) / (num_good_aircraft + num_bad_aircraft)`.
 * The `- 1` discounts a single aircraft with a faulty receiver, so one bad aircraft alone is 0 %.
 * Returned as a 0..1 fraction (4 dp) so gpsjam's own 2 % / 10 % colour thresholds apply unchanged.
 */
export function gpsjamBadShare(good: number, bad: number): number {
  const aircraft = good + bad;
  if (aircraft <= 0 || bad <= 1) return 0;
  return Math.round(((bad - 1) / aircraft) * 1e4) / 1e4;
}

/**
 * gpsjam day file → cells whose gpsjam share (`gpsjamBadShare`, i.e. bad ≥ 2) is above zero; the
 * full grid would exceed 4 MB and gpsjam draws a 0 % cell as "low" anyway. `totalCells` still
 * counts the whole grid. When more than `max` cells qualify, the ones with the most degraded
 * aircraft are kept (ties: higher share, then h3).
 */
export function parseGpsJamDay(text: string, date: string, max = MAX_JAM_CELLS): { items: GpsJamCell[]; totalCells: number } {
  const it = csvRows(text);
  const head = it.next();
  if (head.done) return { items: [], totalCells: 0 };
  const h = head.value.map((x) => x.trim().toLowerCase());
  const iHex = h.indexOf('hex');
  const iGood = h.indexOf('count_good_aircraft');
  const iBad = h.indexOf('count_bad_aircraft');
  if (iHex < 0 || iGood < 0 || iBad < 0) throw new Error('parse: gpsjam header');
  const items: GpsJamCell[] = [];
  let total = 0;
  for (const r of it) {
    const hex = (r[iHex] ?? '').trim();
    const good = Number(r[iGood]);
    const bad = Number(r[iBad]);
    if (!hex || !Number.isInteger(good) || !Number.isInteger(bad) || good < 0 || bad < 0) continue;
    total++;
    const badRatio = gpsjamBadShare(good, bad);
    if (badRatio <= 0 || !isValidCell(hex)) continue;
    const [lat, lng] = cellToLatLng(hex);
    items.push({ h3: hex, lat: Math.round(lat * 1e4) / 1e4, lng: Math.round(lng * 1e4) / 1e4, badRatio, aircraft: good + bad, bad, basis: 'gpsjam-daily', date });
  }
  items.sort((a, b) => b.bad - a.bad || b.badRatio - a.badRatio || (a.h3 < b.h3 ? -1 : 1));
  return { items: items.slice(0, max), totalCells: total };
}

/** Minimal view of an aircraft for binning (FlightsSnapshot records, columnar rows or Aircraft objects). */
interface Plane {
  /** ICAO hex; a leading `~` marks a non-ICAO address (TIS-B / ADS-R track file). */
  id: string | null;
  lat: number;
  lng: number;
  nacP: number | null;
  /** Epoch seconds of the position, when known. */
  seenAt: number | null;
  onGround: boolean | null;
  /** Position source when the input shape carries it; `undefined` when the shape has no such field. */
  posSource: string | null | undefined;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const bool = (v: unknown): boolean | null => (v === true || v === 1 ? true : v === false || v === 0 ? false : null);

/**
 * Accepts the aviation `FlightsSnapshot` (`{records: FlightRecord[]}` — what the in-process flights
 * feed holds), the columnar `/api/flights` body (`{fields, rows}`), `{items}` or a bare array.
 */
export function planesFrom(data: unknown): Plane[] {
  const out: Plane[] = [];
  if (!data || typeof data !== 'object') return out;
  const d = data as { fields?: unknown; rows?: unknown; items?: unknown; records?: unknown };
  if (Array.isArray(d.fields) && Array.isArray(d.rows)) {
    const f = d.fields as string[];
    const iLat = f.indexOf('lat');
    const iLng = f.indexOf('lng');
    const iN = f.indexOf('nacP');
    const iSeen = f.indexOf('seenAt');
    const iId = f.indexOf('id');
    const iGround = f.indexOf('onGround');
    const iSrc = f.indexOf('posSource');
    if (iLat < 0 || iLng < 0) return out;
    for (const r of d.rows as unknown[][]) {
      const lat = num(r[iLat]);
      const lng = num(r[iLng]);
      if (lat === null || lng === null) continue;
      out.push({
        id: iId < 0 ? null : str(r[iId]),
        lat,
        lng,
        nacP: iN < 0 ? null : num(r[iN]),
        seenAt: iSeen < 0 ? null : num(r[iSeen]),
        onGround: iGround < 0 ? null : bool(r[iGround]),
        posSource: iSrc < 0 ? undefined : str(r[iSrc]),
      });
    }
    return out;
  }
  const items = Array.isArray(data) ? data : Array.isArray(d.records) ? d.records : Array.isArray(d.items) ? d.items : [];
  for (const a of items as Record<string, unknown>[]) {
    if (!a || typeof a !== 'object') continue;
    const lat = num(a.lat);
    const lng = num(a.lng);
    if (lat === null || lng === null) continue;
    out.push({
      id: str(a.id) ?? str(a.hex),
      lat,
      lng,
      nacP: num(a.nacP),
      seenAt: num(a.seenAt),
      onGround: bool(a.onGround),
      posSource: 'posSource' in a ? str(a.posSource) : undefined,
    });
  }
  return out;
}

/**
 * Only airborne ADS-B positions carry a NACp that describes the aircraft's own GNSS fix
 * (docs/reference/03 "the aircraft is not grounded"; gpsjam bins ADS-B NACp only). Skipped:
 *  - aircraft on the ground (surface multipath and taxi-time NACp drops are not interference);
 *  - non-ICAO `~` addresses (TIS-B / ADS-R track files re-broadcast from radar);
 *  - when the input carries a position source, anything other than `adsb` (MLAT, TIS-B, ADS-R,
 *    Mode S or unknown): their NACp is not the aircraft's GNSS integrity.
 */
export function isAirborneAdsb(p: Pick<Plane, 'id' | 'onGround' | 'posSource'>): boolean {
  if (p.onGround === true) return false;
  if (p.id !== null && p.id.startsWith('~')) return false;
  if (p.posSource !== undefined && p.posSource !== 'adsb') return false;
  return true;
}

export interface LiveNacpBins {
  cells: GpsJamCell[];
  /** Airborne ADS-B aircraft with a recent position considered for binning. */
  aircraft: number;
  /** Of those, how many reported a NACp at all. Zero means the binning could not run. */
  withNacp: number;
  /** Positions left out: on the ground / not ADS-B (TIS-B, ADS-R, MLAT, `~` address) / too old or of unknown age. */
  skipped: { ground: number; notAdsb: number; stale: number };
}

/**
 * Bin live aircraft into H3 r4 cells; a cell is reported when it holds ≥ LIVE_MIN_AIRCRAFT
 * airborne ADS-B aircraft that report NACp and at least one reports NACp ≤ LIVE_BAD_NACP.
 * Aircraft without a NACp are not counted either way. With `minSeenAt` (epoch s), positions older
 * than it, or of unknown age, are skipped so a frozen snapshot never yields "live" cells.
 */
export function binLiveNacpDetailed(data: unknown, minSeenAt: number | null = null): LiveNacpBins {
  const cells = new Map<string, { n: number; bad: number; seen: number | null }>();
  let aircraft = 0;
  let withNacp = 0;
  const skipped = { ground: 0, notAdsb: 0, stale: 0 };
  for (const p of planesFrom(data)) {
    if (Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) continue;
    if (p.onGround === true) {
      skipped.ground++;
      continue;
    }
    if (!isAirborneAdsb(p)) {
      skipped.notAdsb++;
      continue;
    }
    if (minSeenAt !== null && (p.seenAt === null || p.seenAt < minSeenAt)) {
      skipped.stale++;
      continue;
    }
    aircraft++;
    if (p.nacP === null) continue;
    withNacp++;
    const h = latLngToCell(p.lat, p.lng, 4);
    const c = cells.get(h) ?? { n: 0, bad: 0, seen: null };
    c.n++;
    if (p.nacP <= LIVE_BAD_NACP) {
      c.bad++;
      if (p.seenAt !== null && (c.seen === null || p.seenAt > c.seen)) c.seen = p.seenAt;
    }
    cells.set(h, c);
  }
  const out: GpsJamCell[] = [];
  for (const [h3, c] of cells) {
    if (c.n < LIVE_MIN_AIRCRAFT || c.bad === 0) continue;
    const [lat, lng] = cellToLatLng(h3);
    out.push({
      h3,
      lat: Math.round(lat * 1e4) / 1e4,
      lng: Math.round(lng * 1e4) / 1e4,
      badRatio: Math.round((c.bad / c.n) * 1e4) / 1e4,
      aircraft: c.n,
      bad: c.bad,
      basis: 'live-nacp',
      date: null,
      ...(c.seen !== null ? { observedAt: new Date(c.seen * 1000).toISOString() } : {}),
    });
  }
  out.sort((a, b) => b.bad - a.bad || (a.h3 < b.h3 ? -1 : 1));
  return { cells: out, aircraft, withNacp, skipped };
}

export function binLiveNacp(data: unknown, minSeenAt: number | null = null): GpsJamCell[] {
  return binLiveNacpDetailed(data, minSeenAt).cells;
}

export interface GpsJamData {
  items: GpsJamCell[];
  totalCells: number;
  suspect: boolean | null;
  date: string | null;
}

/** gpsjam for `date` (YYYY-MM-DD) or the manifest's latest day (cached; a published day never changes). */
export async function gpsInterference(date: string | null) {
  return lookup<GpsJamData>(`gps-jam:${date ?? 'latest'}`, {
    feed: 'gps-interference',
    // A published day never changes; "latest" rolls over once a day.
    ttlMs: date ? 24 * 3600_000 : 3600_000,
    attribution: GPSJAM_ATTRIBUTION,
    note: `gpsjam.org daily aggregate (licence unstated, attributed), share = (bad − 1) / (good + bad) as published by gpsjam; live cells from airborne ADS-B aircraft only (no ground, TIS-B, ADS-R or MLAT positions) with positions ≤ ${LIVE_MAX_POSITION_AGE_S} s old, NACp ≤ ${LIVE_BAD_NACP} counted as degraded, ≥ ${LIVE_MIN_AIRCRAFT} aircraft per H3 r4 cell`,
    isEmpty: (d) => d.date === null && d.items.length === 0,
    deadlineMs: 45_000,
    run: async (signal) => {
      const providers: Record<string, ProviderRun> = {};
      let day: string | null = null;
      let suspect: boolean | null = null;
      const manifest = await runProvider(async () => parseManifest((await httpText(`${GPSJAM_BASE}manifest.csv`, { signal, timeoutMs: 15_000 })).text ?? ''), (r) => r.length);
      providers.gpsjam_manifest = manifest.run;
      const rows = manifest.result ?? [];
      if (date) {
        day = date;
        suspect = rows.find((r) => r.date === date)?.suspect ?? null;
      } else if (rows.length) {
        const last = rows[rows.length - 1]!;
        day = last.date;
        suspect = last.suspect;
      }
      let items: GpsJamCell[] = [];
      let totalCells = 0;
      if (day) {
        const d = day;
        const daily = await runProvider(async () => parseGpsJamDay((await httpText(`${GPSJAM_BASE}${d}-h3_4.csv`, { signal, timeoutMs: 30_000 })).text ?? '', d), (r) => r.items.length);
        providers.gpsjam = daily.run;
        if (daily.result) {
          items = daily.result.items;
          totalCells = daily.result.totalCells;
        } else day = null;
      }
      const observedAt = day ? Date.parse(`${day}T23:59:59Z`) : null;
      return { data: { items, totalCells, suspect, date: day }, providers, observedAt };
    },
  });
}

const unavailable = (error: string, ms = 0): ProviderRun => ({ status: { ok: false, count: 0, ms, age_s: null, error }, okAt: null });

/**
 * Live NACp bins from the flights feed when it runs in this process (read in-process with
 * getFeed().peek(); never over HTTP and never triggering an upstream fetch). Computed per request
 * so the cells are as fresh as the flights snapshot.
 *
 * Honesty: `ok: true` (possibly with zero cells) only when the binning actually ran over recent
 * aircraft that report NACp. No flights feed, no snapshot, no recent positions or no NACp field at
 * all → `ok: false` with a reason, never "0 degraded cells" presented as truth.
 */
export function liveNacpCells(now = Date.now()): { cells: GpsJamCell[]; run: ProviderRun } {
  const flights = getFeed('flights');
  if (!flights) return { cells: [], run: unavailable('flights_feed_not_running') };
  const snap = flights.peek();
  if (snap.data === null) return { cells: [], run: unavailable('no_flights_snapshot') };
  const t0 = Date.now();
  const bins = binLiveNacpDetailed(snap.data, Math.floor(now / 1000) - LIVE_MAX_POSITION_AGE_S);
  const ms = Date.now() - t0;
  if (bins.aircraft === 0) return { cells: [], run: unavailable('no_recent_positions', ms) };
  if (bins.withNacp === 0) return { cells: [], run: unavailable('nacp_not_reported', ms) };
  const at = snap.meta.fetchedAt ? Date.parse(snap.meta.fetchedAt) : null;
  return { cells: bins.cells, run: { status: { ok: true, count: bins.cells.length, ms, age_s: at === null ? null : Math.max(0, Math.round((now - at) / 1000)) }, okAt: at } };
}
