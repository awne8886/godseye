/**
 * NASA FIRMS 24 h CSV parsing and FRP-ranked sampling. Pure; unit-tested. Owner: layers-hazards.
 *
 * VIIRS rows: latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,
 *   version,bright_ti5,frp,daynight — confidence is a word (low/nominal/high; older files l/n/h).
 * MODIS rows: …,brightness,…,confidence(0–100),…,bright_t31,frp,daynight — normalised to
 *   low (< 30) / nominal / high (≥ 80) per the FIRMS MODIS guidance.
 * `acq_date` + `acq_time` (HHMM) are the overpass time in UTC.
 *
 * Sampling (§0.1): the global 24 h set is ~250k pixels; the response keeps the N pixels with the
 * highest fire radiative power (ties: newer overpass, then id), NEVER every k-th row. Because
 * the global top-N is a subset of the union of each file's top-N, each file is reduced to its
 * own top-N on arrival (bounded memory) and merged at response time.
 */
import { csvRows } from '@/lib/csv';
import type { FirePixel } from '@/lib/types';

export type FireSatellite = FirePixel['satellite'];
export type FireConfidence = FirePixel['confidence'];

/** One pixel in FIRE_FIELDS order-friendly form (`seenAt` = epoch seconds). */
export interface FireRow {
  id: string;
  lat: number;
  lng: number;
  frpMw: number | null;
  brightnessK: number | null;
  confidence: FireConfidence;
  dayNight: 'D' | 'N' | null;
  satellite: FireSatellite;
  seenAt: number;
}

export const FIRMS_FILES: readonly { satellite: FireSatellite; url: string; provider: string }[] = [
  { satellite: 'SNPP', provider: 'firms_viirs_snpp', url: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv' },
  { satellite: 'NOAA20', provider: 'firms_viirs_noaa20', url: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv' },
  { satellite: 'NOAA21', provider: 'firms_viirs_noaa21', url: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-21-viirs-c2/csv/J2_VIIRS_C2_Global_24h.csv' },
  { satellite: 'MODIS', provider: 'firms_modis', url: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_Global_24h.csv' },
];

export const MAX_FIRE_ROWS = 30_000;

export const FIRE_SAMPLING_RULE = `top ${MAX_FIRE_ROWS.toLocaleString('en-US')} pixels by fire radiative power (FRP, MW), ties by newest overpass; never by stride`;

const SAT_CODE: Record<FireSatellite, string> = { SNPP: 'N', NOAA20: 'N20', NOAA21: 'N21', MODIS: 'M' };

export function viirsConfidence(v: string): FireConfidence | null {
  switch (v.trim().toLowerCase()) {
    case 'l':
    case 'low':
      return 'low';
    case 'n':
    case 'nominal':
      return 'nominal';
    case 'h':
    case 'high':
      return 'high';
    default:
      return null;
  }
}

export function modisConfidence(v: string): FireConfidence | null {
  const n = Number(v);
  if (v.trim() === '' || !Number.isFinite(n) || n < 0 || n > 100) return null;
  return n < 30 ? 'low' : n >= 80 ? 'high' : 'nominal';
}

/** `2026-09-29` + `0003` (HHMM UTC) → epoch seconds. */
export function overpassSeconds(date: string, time: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,4}$/.test(time.trim())) return null;
  const t = time.trim().padStart(4, '0');
  const ms = Date.parse(`${date}T${t.slice(0, 2)}:${t.slice(2)}:00Z`);
  return Number.isFinite(ms) ? ms / 1000 : null;
}

const num = (v: string | undefined): number | null => {
  if (v === undefined || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Higher FRP first; ties → newer overpass, then id (deterministic). Null FRP ranks last. */
export function compareFire(a: FireRow, b: FireRow): number {
  const fa = a.frpMw ?? -1;
  const fb = b.frpMw ?? -1;
  if (fa !== fb) return fb - fa;
  if (a.seenAt !== b.seenAt) return b.seenAt - a.seenAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export interface ParsedFirms {
  /** Valid pixels in the file (before sampling). */
  total: number;
  /** The file's own top-N by FRP. */
  top: FireRow[];
  /** Newest overpass in the file (epoch seconds). */
  newestSeenAt: number | null;
}

/** Parse one FIRMS CSV and keep its top `limit` pixels by FRP. */
export function parseFirmsCsv(text: string, satellite: FireSatellite, limit = MAX_FIRE_ROWS): ParsedFirms {
  const rows = csvRows(text);
  const head = rows.next();
  if (head.done) return { total: 0, top: [], newestSeenAt: null };
  const h = head.value.map((x) => x.trim().toLowerCase());
  const col = (name: string) => h.indexOf(name);
  const iLat = col('latitude');
  const iLng = col('longitude');
  const iBright = col('bright_ti4') >= 0 ? col('bright_ti4') : col('brightness');
  const iConf = col('confidence');
  const iDate = col('acq_date');
  const iTime = col('acq_time');
  const iFrp = col('frp');
  const iDn = col('daynight');
  if (iLat < 0 || iLng < 0 || iDate < 0 || iTime < 0) throw new Error('parse: FIRMS header missing latitude/longitude/acq_date/acq_time');
  const conf = satellite === 'MODIS' ? modisConfidence : viirsConfidence;
  const code = SAT_CODE[satellite];
  const all: FireRow[] = [];
  let newest = 0;
  for (const r of rows) {
    const lat = num(r[iLat]);
    const lng = num(r[iLng]);
    if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const seenAt = overpassSeconds(r[iDate] ?? '', r[iTime] ?? '');
    if (seenAt === null) continue;
    const confidence = iConf >= 0 ? conf(r[iConf] ?? '') : null;
    if (confidence === null) continue;
    const frp = iFrp >= 0 ? num(r[iFrp]) : null;
    const dn = iDn >= 0 ? (r[iDn] ?? '').trim().toUpperCase() : '';
    const t = (r[iTime] ?? '').trim().padStart(4, '0');
    all.push({
      id: `${code}-${(r[iDate] ?? '').replace(/-/g, '')}${t}-${lat}-${lng}`,
      lat,
      lng,
      frpMw: frp !== null && frp >= 0 ? frp : null,
      brightnessK: iBright >= 0 ? num(r[iBright]) : null,
      confidence,
      dayNight: dn === 'D' || dn === 'N' ? dn : null,
      satellite,
      seenAt,
    });
    if (seenAt > newest) newest = seenAt;
  }
  all.sort(compareFire);
  return { total: all.length, top: all.slice(0, limit), newestSeenAt: newest || null };
}

/** Merge per-file top lists into the global top-N (same ordering; ids are unique per satellite). */
export function sampleByFrp(lists: readonly (readonly FireRow[])[], limit = MAX_FIRE_ROWS): FireRow[] {
  const merged: FireRow[] = [];
  for (const l of lists) for (const r of l) merged.push(r);
  merged.sort(compareFire);
  return merged.slice(0, limit);
}
