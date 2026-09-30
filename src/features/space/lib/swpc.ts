/**
 * NOAA SWPC parsers (pure, isomorphic). Owner: layers-space.
 *
 * §6.2 breaking changes encoded here (probed 2026-09-30):
 *  - `/products/noaa-planetary-k-index.json` is an ARRAY OF OBJECTS `{time_tag, Kp, a_running,
 *    station_count}` (it used to be an array of arrays with a header row). `time_tag` is the START of
 *    the 3-hour interval and carries no zone designator: it is UTC → normalizeUtc().
 *  - Solar wind moved from `/products/solar-wind/*` (404) to `/json/rtsw/rtsw_{wind,mag}_1m.json`.
 *    Those files interleave rows from several spacecraft (IMAP, ACE, SOLAR1…) every minute; only
 *    rows with `active: true` are the operational feed. Rows are newest first; time_tag has no Z.
 *  - `/products/alerts.json` `issue_datetime` is "YYYY-MM-DD hh:mm:ss.sss" UTC (no T, no Z).
 *  - `product_id` repeats across days (e.g. "EF3A" daily), so alert ids include the issue time.
 */
import { normalizeUtc } from '@/lib/freshness';
import type { KpReading, SpaceWeatherResponse } from '@/lib/types';

const ms = (iso: string | null) => (iso ? Date.parse(iso) : Number.NaN);

// ── Kp ───────────────────────────────────────────────────────────────────────────
export interface KpRow {
  time_tag?: unknown;
  Kp?: unknown;
}

export interface KpPoint {
  at: string;
  kp: number;
}

/** Valid Kp readings, oldest first. Rows with a missing/out-of-range Kp are dropped, never zeroed. */
export function parseKp(rows: unknown): KpPoint[] {
  if (!Array.isArray(rows)) return [];
  const out: KpPoint[] = [];
  for (const r of rows as KpRow[]) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) continue; // the old array-of-arrays shape is not accepted silently
    const at = normalizeUtc(typeof r.time_tag === 'string' ? r.time_tag : null);
    const kp = typeof r.Kp === 'number' ? r.Kp : typeof r.Kp === 'string' && r.Kp.trim() !== '' ? Number(r.Kp) : Number.NaN;
    if (!at || !Number.isFinite(kp) || kp < 0 || kp > 9) continue;
    out.push({ at, kp });
  }
  return out.sort((a, b) => ms(a.at) - ms(b.at));
}

/**
 * NOAA G-scale from Kp (thirds: 4.67 = "5-"). G1 Kp 5, G2 6, G3 7, G4 8, G5 9; Kp 4 is "active",
 * Kp 3 "unsettled". A missing reading is Unknown — never Quiet.
 */
export function kpReading(kp: number | null, observedAt: string | null): KpReading {
  if (kp === null || !Number.isFinite(kp)) {
    return { kp: null, observedAt: null, stormLevel: 'Unknown', label: 'No Kp reading', color: 'var(--text-muted)' };
  }
  const base = { kp, observedAt };
  if (kp >= 8.67) return { ...base, stormLevel: 'G5', label: 'Extreme storm (G5)', color: 'var(--alert-red)' };
  if (kp >= 7.67) return { ...base, stormLevel: 'G4', label: 'Severe storm (G4)', color: 'var(--alert-red)' };
  if (kp >= 6.67) return { ...base, stormLevel: 'G3', label: 'Strong storm (G3)', color: 'var(--alert-orange)' };
  if (kp >= 5.67) return { ...base, stormLevel: 'G2', label: 'Moderate storm (G2)', color: 'var(--alert-orange)' };
  if (kp >= 4.67) return { ...base, stormLevel: 'G1', label: 'Minor storm (G1)', color: 'var(--gold-light)' };
  if (kp >= 3.67) return { ...base, stormLevel: 'Unsettled', label: 'Active', color: 'var(--gold-primary)' };
  if (kp >= 2.67) return { ...base, stormLevel: 'Unsettled', label: 'Unsettled', color: 'var(--gold-primary)' };
  return { ...base, stormLevel: 'Quiet', label: 'Quiet', color: 'var(--alert-green)' };
}

// ── RTSW solar wind ─────────────────────────────────────────────────────────────
export const RTSW_RANGES = {
  speedKmS: [150, 3000],
  densityPcc: [0, 200],
  btNt: [0, 200],
  bzNt: [-200, 200],
} as const;

const inRange = (v: unknown, [lo, hi]: readonly [number, number]): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

interface RtswRow {
  time_tag?: unknown;
  active?: unknown;
  source?: unknown;
  [k: string]: unknown;
}

/** Active rows only, newest first, with a normalised time. */
function activeRows(rows: unknown): { at: string; row: RtswRow }[] {
  if (!Array.isArray(rows)) return [];
  const out: { at: string; row: RtswRow }[] = [];
  for (const r of rows as RtswRow[]) {
    if (!r || typeof r !== 'object' || r.active !== true) continue;
    const at = normalizeUtc(typeof r.time_tag === 'string' ? r.time_tag : null);
    if (at) out.push({ at, row: r });
  }
  return out.sort((a, b) => ms(b.at) - ms(a.at));
}

export interface PlasmaReading {
  speedKmS: number;
  densityPcc: number;
  observedAt: string;
  source: string | null;
}

export interface MagReading {
  btNt: number;
  bzNt: number;
  observedAt: string;
  source: string | null;
}

/** Newest active `rtsw_wind_1m` row whose speed and density are physically sane. */
export function parseRtswWind(rows: unknown): PlasmaReading | null {
  for (const { at, row } of activeRows(rows)) {
    if (inRange(row.proton_speed, RTSW_RANGES.speedKmS) && inRange(row.proton_density, RTSW_RANGES.densityPcc)) {
      return { speedKmS: row.proton_speed, densityPcc: row.proton_density, observedAt: at, source: typeof row.source === 'string' ? row.source : null };
    }
  }
  return null;
}

/** Newest active `rtsw_mag_1m` row with sane Bt and Bz (GSM, the geo-effective component). */
export function parseRtswMag(rows: unknown): MagReading | null {
  for (const { at, row } of activeRows(rows)) {
    if (inRange(row.bt, RTSW_RANGES.btNt) && inRange(row.bz_gsm, RTSW_RANGES.bzNt)) {
      return { btNt: row.bt, bzNt: row.bz_gsm, observedAt: at, source: typeof row.source === 'string' ? row.source : null };
    }
  }
  return null;
}

export function solarWind(plasma: PlasmaReading | null, mag: MagReading | null): SpaceWeatherResponse['solarWind'] {
  const times = [plasma?.observedAt, mag?.observedAt].filter((t): t is string => !!t);
  // The older of the two readings, so the panel never claims the pair is fresher than it is.
  const observedAt = times.length ? times.reduce((a, b) => (ms(a) <= ms(b) ? a : b)) : null;
  const sources = [...new Set([plasma?.source, mag?.source].filter((s): s is string => !!s))];
  return {
    speedKmS: plasma?.speedKmS ?? null,
    densityPcc: plasma?.densityPcc ?? null,
    btNt: mag?.btNt ?? null,
    bzNt: mag?.bzNt ?? null,
    observedAt,
    source: sources.length ? sources.join(' / ') : null,
  };
}

// ── GOES X-ray ───────────────────────────────────────────────────────────────────
const XRAY_CLASSES: readonly [string, number][] = [
  ['X', 1e-4],
  ['M', 1e-5],
  ['C', 1e-6],
  ['B', 1e-7],
  ['A', 1e-8],
];

/** Flare class from 0.1–0.8 nm flux (W/m²): A < 1e-7 ≤ B < 1e-6 ≤ C < 1e-5 ≤ M < 1e-4 ≤ X. */
export function xrayClass(flux: number | null | undefined): string | null {
  if (typeof flux !== 'number' || !Number.isFinite(flux) || flux <= 0) return null;
  for (let i = 0; i < XRAY_CLASSES.length; i++) {
    const [letter, base] = XRAY_CLASSES[i]!;
    if (flux >= base || i === XRAY_CLASSES.length - 1) {
      const v = Math.round((flux / base) * 10) / 10;
      // 9.96e-7 rounds to "B10.0": that is a C1.0.
      if (v >= 10 && i > 0) return `${XRAY_CLASSES[i - 1]![0]}1.0`;
      return `${letter}${v.toFixed(1)}`;
    }
  }
  return null;
}

interface XrayRow {
  time_tag?: unknown;
  flux?: unknown;
  energy?: unknown;
}

/** Newest 0.1–0.8 nm (long-channel) sample; the 0.05–0.4 nm channel does not define flare class. */
export function parseXray(rows: unknown): SpaceWeatherResponse['xray'] {
  const none = { flux: null, class: null, observedAt: null };
  if (!Array.isArray(rows)) return none;
  let best: { flux: number; at: string } | null = null;
  for (const r of rows as XrayRow[]) {
    if (!r || typeof r !== 'object' || r.energy !== '0.1-0.8nm') continue;
    if (typeof r.flux !== 'number' || !Number.isFinite(r.flux) || r.flux <= 0) continue;
    const at = normalizeUtc(typeof r.time_tag === 'string' ? r.time_tag : null);
    if (at && (!best || ms(at) > ms(best.at))) best = { flux: r.flux, at };
  }
  return best ? { flux: best.flux, class: xrayClass(best.flux), observedAt: best.at } : none;
}

// ── NOAA scales ──────────────────────────────────────────────────────────────────
const scaleInt = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : typeof v === 'number' ? v : Number.NaN;
  return Number.isInteger(n) && n >= 0 && n <= 5 ? n : null;
};

/** Current R/S/G scale levels (entry "0" is the current observed period). */
export function parseScales(body: unknown): SpaceWeatherResponse['scales'] {
  const cur = body && typeof body === 'object' ? (body as Record<string, unknown>)['0'] : null;
  if (!cur || typeof cur !== 'object') return { R: null, S: null, G: null };
  const get = (k: 'R' | 'S' | 'G') => scaleInt(((cur as Record<string, unknown>)[k] as { Scale?: unknown } | undefined)?.Scale);
  return { R: get('R'), S: get('S'), G: get('G') };
}

// ── Alerts ───────────────────────────────────────────────────────────────────────
export const MAX_ALERTS = 25;
const MAX_ALERT_CHARS = 1200;

interface AlertRow {
  product_id?: unknown;
  issue_datetime?: unknown;
  message?: unknown;
}

/** Alerts newest first, ISO times, plain text (rendered as text, never HTML). */
export function parseAlerts(rows: unknown): SpaceWeatherResponse['alerts'] {
  if (!Array.isArray(rows)) return [];
  const out: SpaceWeatherResponse['alerts'] = [];
  const seen = new Set<string>();
  for (const r of rows as AlertRow[]) {
    if (!r || typeof r !== 'object') continue;
    const issuedAt = normalizeUtc(typeof r.issue_datetime === 'string' ? r.issue_datetime : null);
    const message = typeof r.message === 'string' ? r.message.replace(/\r\n?/g, '\n').trim().slice(0, MAX_ALERT_CHARS) : '';
    if (!issuedAt || !message) continue;
    const id = `${typeof r.product_id === 'string' ? r.product_id : 'alert'}-${issuedAt}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, issuedAt, message });
  }
  return out.sort((a, b) => ms(b.issuedAt) - ms(a.issuedAt)).slice(0, MAX_ALERTS);
}
