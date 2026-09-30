/**
 * Builds the Flight Path Planner airport index from OurAirports (public domain, rebuilt nightly)
 * joined with mwgg/Airports time zones (MIT):
 *   public/data/airports.min.json      large + medium airports and every airport with scheduled
 *                                      service or an IATA code (the default search index)
 *   public/data/airports-all.json.gz   every open airfield (adds small airports and seaplane bases;
 *                                      heliports, balloonports and closed fields are left out)
 *   public/data/airports-runways.json.gz  runways of every airfield in the full index
 *
 *   node --experimental-transform-types --import ./tools/ts-loader.mjs tools/build-airports.ts [--src DIR]
 *
 * `--src DIR` reads airports.csv, runways.csv, countries.csv, regions.csv and mwgg.json from DIR
 * (a previous download) instead of fetching them. Owner: feature-flight-paths.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseCsv } from '@/lib/csv';
import { AIRPORT_FIELDS, AIRPORT_TYPES, FT_TO_M, isPavedSurface, type AirportIndexFile, type AirportRow, type RunwayIndexFile, type RunwayRow } from '@/features/flight-paths/lib/data-format';

export const OURAIRPORTS = 'https://davidmegginson.github.io/ourairports-data';
export const MWGG_URL = 'https://raw.githubusercontent.com/mwgg/Airports/master/airports.json';
export const OUT_DIR = fileURLToPath(new URL('../public/data/', import.meta.url));

export interface AirportSources {
  airportsCsv: string;
  runwaysCsv: string;
  countriesCsv: string;
  regionsCsv: string;
  mwggJson: string;
  lastModified?: Record<string, string | null>;
}

interface MwggEntry {
  icao?: string;
  iata?: string;
  tz?: string;
}

const str = (v: string | undefined): string | null => {
  const t = (v ?? '').trim();
  return t ? t : null;
};
const numOrNull = (v: string | undefined): number | null => {
  const t = (v ?? '').trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** A valid IANA-looking zone name (mwgg has a few empty/odd values). */
const isZone = (tz: string | undefined): tz is string => typeof tz === 'string' && /^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+){1,2}$/.test(tz);

export function buildRunways(runwaysCsv: string, keep: ReadonlySet<string>): { byIdent: Record<string, RunwayRow[]>; longestM: Map<string, number> } {
  const byIdent: Record<string, RunwayRow[]> = {};
  const longestM = new Map<string, number>();
  for (const r of parseCsv(runwaysCsv)) {
    const ident = str(r.airport_ident);
    if (!ident || !keep.has(ident)) continue;
    const lengthFt = numOrNull(r.length_ft);
    const closed = r.closed === '1' ? 1 : 0;
    const surface = str(r.surface);
    const row: RunwayRow = [str(r.le_ident), str(r.he_ident), lengthFt, numOrNull(r.width_ft), surface, r.lighted === '1' ? 1 : 0, closed];
    (byIdent[ident] ??= []).push(row);
    if (!closed && lengthFt !== null && isPavedSurface(surface)) {
      const m = Math.round(lengthFt * FT_TO_M);
      if (m > (longestM.get(ident) ?? 0)) longestM.set(ident, m);
    }
  }
  return { byIdent, longestM };
}

export interface BuiltAirports {
  min: AirportIndexFile;
  all: AirportIndexFile;
  runways: RunwayIndexFile;
}

export function buildAirportIndex(src: AirportSources, now = new Date()): BuiltAirports {
  const mwgg = JSON.parse(src.mwggJson) as Record<string, MwggEntry>;
  const tzByCode = new Map<string, string>();
  for (const [key, e] of Object.entries(mwgg)) {
    if (!isZone(e.tz)) continue;
    tzByCode.set(key.toUpperCase(), e.tz);
    if (e.icao) tzByCode.set(e.icao.toUpperCase(), e.tz);
  }
  const countries: Record<string, string> = {};
  for (const c of parseCsv(src.countriesCsv)) if (c.code && c.name) countries[c.code] = c.name;
  const regions: Record<string, string> = {};
  for (const r of parseCsv(src.regionsCsv)) if (r.code && r.name) regions[r.code] = r.name;

  const raw = parseCsv(src.airportsCsv);
  const keepAll = new Set<string>();
  for (const a of raw) {
    const t = a.type as (typeof AIRPORT_TYPES)[number];
    if (t === 'closed' || t === 'heliport' || t === 'balloonport' || !AIRPORT_TYPES.includes(t)) continue;
    if (a.ident) keepAll.add(a.ident);
  }
  const { byIdent, longestM } = buildRunways(src.runwaysCsv, keepAll);

  const minRows: AirportRow[] = [];
  const allRows: AirportRow[] = [];
  for (const a of raw) {
    const ident = str(a.ident);
    if (!ident || !keepAll.has(ident)) continue;
    const lat = numOrNull(a.latitude_deg);
    const lng = numOrNull(a.longitude_deg);
    if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const type = AIRPORT_TYPES.indexOf(a.type as (typeof AIRPORT_TYPES)[number]);
    const icao = str(a.icao_code)?.toUpperCase() ?? null;
    const iata = str(a.iata_code)?.toUpperCase() ?? null;
    const gps = str(a.gps_code)?.toUpperCase() ?? null;
    const scheduled = a.scheduled_service === 'yes' ? 1 : 0;
    const tz = [icao, gps, ident.toUpperCase()].map((c) => (c ? tzByCode.get(c) : undefined)).find(isZone) ?? null;
    const keywords = str(a.keywords)?.slice(0, 120) ?? null;
    const row: AirportRow = [
      ident,
      icao,
      iata && /^[A-Z0-9]{3}$/.test(iata) ? iata : null,
      gps,
      (str(a.name) ?? ident).slice(0, 120),
      type,
      Math.round(lat * 1e5) / 1e5,
      Math.round(lng * 1e5) / 1e5,
      numOrNull(a.elevation_ft),
      str(a.municipality),
      (str(a.iso_country) ?? 'XX').slice(0, 2),
      str(a.iso_region),
      scheduled as 0 | 1,
      tz,
      keywords,
      longestM.get(ident) ?? null,
    ];
    allRows.push(row);
    if (type <= 1 || scheduled || row[2]) minRows.push(row);
  }
  const base = { version: 1 as const, generatedAt: now.toISOString(), sources: src.lastModified ?? {}, fields: AIRPORT_FIELDS, countries, regions };
  return {
    min: { ...base, rows: minRows },
    all: { ...base, rows: allRows },
    runways: { version: 1, generatedAt: now.toISOString(), byIdent },
  };
}

async function download(url: string, ua: string): Promise<{ text: string; lastModified: string | null }> {
  const res = await fetch(url, { headers: { 'User-Agent': ua } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return { text: await res.text(), lastModified: res.headers.get('last-modified') };
}

export function buildUserAgent(): string {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  return `GODSEYE/${pkg.version} (+https://github.com/awne8886/godseye; contact https://github.com/awne8886/godseye/issues) build-tools`;
}

async function main(argv: string[]) {
  const srcIdx = argv.indexOf('--src');
  let sources: AirportSources;
  if (srcIdx >= 0 && argv[srcIdx + 1]) {
    const dir = argv[srcIdx + 1]!.replace(/\/?$/, '/');
    const read = (f: string) => readFileSync(dir + f, 'utf8');
    sources = {
      airportsCsv: read('airports.csv'),
      runwaysCsv: read('runways.csv'),
      countriesCsv: read('countries.csv'),
      regionsCsv: read('regions.csv'),
      mwggJson: read('mwgg.json'),
      lastModified: { ourairports: `local copy (${dir})`, mwgg: null },
    };
  } else {
    const ua = buildUserAgent();
    const [ap, rw, co, re, mw] = await Promise.all([
      download(`${OURAIRPORTS}/airports.csv`, ua),
      download(`${OURAIRPORTS}/runways.csv`, ua),
      download(`${OURAIRPORTS}/countries.csv`, ua),
      download(`${OURAIRPORTS}/regions.csv`, ua),
      download(MWGG_URL, ua),
    ]);
    sources = {
      airportsCsv: ap.text,
      runwaysCsv: rw.text,
      countriesCsv: co.text,
      regionsCsv: re.text,
      mwggJson: mw.text,
      lastModified: { ourairports: ap.lastModified, mwgg: mw.lastModified },
    };
  }
  const built = buildAirportIndex(sources);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(`${OUT_DIR}airports.min.json`, JSON.stringify(built.min));
  writeFileSync(`${OUT_DIR}airports-all.json.gz`, gzipSync(JSON.stringify(built.all), { level: 9 }));
  writeFileSync(`${OUT_DIR}airports-runways.json.gz`, gzipSync(JSON.stringify(built.runways), { level: 9 }));
  console.log(`airports: ${built.min.rows.length} indexed, ${built.all.rows.length} airfields, ${Object.keys(built.runways.byIdent).length} with runways`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
