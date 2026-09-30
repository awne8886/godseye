/**
 * Builds the Flight Path Planner route indexes:
 *   public/data/routes-vrs.json.gz        VRS standing-data routes (CC0, mirrored by adsb.lol):
 *                                          airport chain (`KJFK-EGLL`, multi-stop `KLAS-EGLL-…`) →
 *                                          callsigns. The server derives callsign → chain and
 *                                          ordered pair → callsigns from it.
 *   public/data/routes-openflights.json.gz  OpenFlights routes.dat (ODbL, frozen June 2014,
 *                                          historical only) + airlines.dat (IATA↔ICAO↔telephony)
 *
 *   node --experimental-transform-types --import ./tools/ts-loader.mjs tools/build-routes.ts [--src DIR]
 *
 * `--src DIR` reads routes.csv.gz, routes.dat and airlines.dat from DIR. Owner: feature-flight-paths.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { csvRows } from '@/lib/csv';
import type { HistoricalRow, OpenFlightsFile, VrsRoutesFile } from '@/features/flight-paths/lib/data-format';
import { OUT_DIR, buildUserAgent } from './build-airports';

export const VRS_ROUTES_URL = 'https://vrs-standing-data.adsb.lol/routes.csv.gz';
export const OPENFLIGHTS = 'https://raw.githubusercontent.com/jpatokal/openflights/master/data';

const CALLSIGN_RE = /^[A-Z0-9]{2,8}$/;
const ICAO_RE = /^[A-Z0-9]{4}$/;

/** Header `Callsign,Code,Number,AirlineCode,AirportCodes`; AirportCodes is hyphen-joined ICAO. */
export function buildVrsIndex(csv: string, lastModified: string | null, now = new Date()): VrsRoutesFile {
  const chains: Record<string, string[]> = {};
  const it = csvRows(csv);
  const header = it.next();
  const cols = header.done ? [] : header.value.map((h) => h.trim());
  const iCs = cols.indexOf('Callsign');
  const iCodes = cols.indexOf('AirportCodes');
  if (iCs < 0 || iCodes < 0) throw new Error('VRS routes.csv: unexpected header');
  for (const r of it) {
    const cs = (r[iCs] ?? '').trim().toUpperCase();
    const codes = (r[iCodes] ?? '').trim().toUpperCase().split('-');
    if (!CALLSIGN_RE.test(cs) || codes.length < 2 || !codes.every((c) => ICAO_RE.test(c))) continue;
    (chains[codes.join('-')] ??= []).push(cs);
  }
  for (const list of Object.values(chains)) list.sort();
  return { version: 1, generatedAt: now.toISOString(), lastModified, licence: 'CC0-1.0', chains };
}

const nul = (v: string | undefined) => (v === undefined || v === '\\N' || v.trim() === '' || v === '-' ? null : v.trim());

/** routes.dat: Airline, Airline ID, Source, Source ID, Dest, Dest ID, Codeshare, Stops, Equipment. */
export function buildOpenFlights(routesDat: string, airlinesDat: string, now = new Date()): OpenFlightsFile {
  const airlines: OpenFlightsFile['airlines'] = {};
  const nameById = new Map<string, string>();
  for (const r of csvRows(airlinesDat)) {
    const [id, name, , iata, icao, callsign, country, active] = r;
    const n = nul(name);
    if (id && n) nameById.set(id, n);
    const code = nul(icao)?.toUpperCase();
    if (!code || !/^[A-Z]{3}$/.test(code) || !n) continue;
    const isActive = active === 'Y' ? 1 : 0;
    const prev = airlines[code];
    // The same ICAO designator was reused over the years: keep the active holder.
    if (prev && prev[4] === 1 && !isActive) continue;
    const i = nul(iata)?.toUpperCase() ?? null;
    airlines[code] = [i && /^[A-Z0-9]{2}$/.test(i) ? i : null, n, nul(callsign), nul(country), isActive];
  }
  const routes: Record<string, HistoricalRow[]> = {};
  for (const r of csvRows(routesDat)) {
    const [airline, airlineId, src, , dst, , codeshare, stops, equipment] = r;
    const a = nul(src)?.toUpperCase();
    const b = nul(dst)?.toUpperCase();
    if (!a || !b || !/^[A-Z0-9]{3,4}$/.test(a) || !/^[A-Z0-9]{3,4}$/.test(b)) continue;
    const label = (airlineId && nameById.get(airlineId)) ?? nul(airline) ?? 'Unknown airline';
    (routes[`${a}-${b}`] ??= []).push([label, codeshare === 'Y' ? 1 : 0, Number(stops) || 0, nul(equipment) ?? '']);
  }
  return {
    version: 1,
    generatedAt: now.toISOString(),
    licence: 'ODbL-1.0',
    note: 'OpenFlights route data stopped updating in June 2014; historical value only.',
    routes,
    airlines,
  };
}

async function main(argv: string[]) {
  const srcIdx = argv.indexOf('--src');
  let vrsCsv: string;
  let vrsLm: string | null = null;
  let routesDat: string;
  let airlinesDat: string;
  if (srcIdx >= 0 && argv[srcIdx + 1]) {
    const dir = argv[srcIdx + 1]!.replace(/\/?$/, '/');
    vrsCsv = gunzipSync(readFileSync(`${dir}routes.csv.gz`)).toString('utf8');
    vrsLm = `local copy (${dir})`;
    routesDat = readFileSync(`${dir}routes.dat`, 'utf8');
    airlinesDat = readFileSync(`${dir}airlines.dat`, 'utf8');
  } else {
    const headers = { 'User-Agent': buildUserAgent() };
    const vrs = await fetch(VRS_ROUTES_URL, { headers });
    if (!vrs.ok) throw new Error(`${VRS_ROUTES_URL}: HTTP ${vrs.status}`);
    vrsLm = vrs.headers.get('last-modified');
    const buf = Buffer.from(await vrs.arrayBuffer());
    // fetch() may already have decoded a Content-Encoding: gzip response; the file itself is gzip.
    vrsCsv = (buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString('utf8');
    const get = async (f: string) => {
      const r = await fetch(`${OPENFLIGHTS}/${f}`, { headers });
      if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
      return r.text();
    };
    [routesDat, airlinesDat] = await Promise.all([get('routes.dat'), get('airlines.dat')]);
  }
  const vrs = buildVrsIndex(vrsCsv, vrsLm);
  const of = buildOpenFlights(routesDat, airlinesDat);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(`${OUT_DIR}routes-vrs.json.gz`, gzipSync(JSON.stringify(vrs), { level: 9 }));
  writeFileSync(`${OUT_DIR}routes-openflights.json.gz`, gzipSync(JSON.stringify(of), { level: 9 }));
  console.log(`routes: ${Object.keys(vrs.chains).length} VRS chains, ${Object.keys(of.routes).length} OpenFlights pairs, ${Object.keys(of.airlines).length} airlines`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
