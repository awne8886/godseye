/**
 * Compiles docs/DATA_SOURCES.md from every agent's probe log in docs/data-sources/*.md plus the
 * licence summary below. Agents only edit their own docs/data-sources/<agent>.md; this file is
 * the only writer of docs/DATA_SOURCES.md.
 *
 *   node --experimental-transform-types --import ./tools/ts-loader.mjs tools/compile-data-sources.ts [--check]
 *
 * `--check` exits 1 when docs/DATA_SOURCES.md is out of date (a unit test checks the same).
 * Owner: pages-docs-privacy-ops.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SOURCES_DIR = fileURLToPath(new URL('../docs/data-sources/', import.meta.url));
export const OUTPUT_PATH = fileURLToPath(new URL('../docs/DATA_SOURCES.md', import.meta.url));

export interface LicenceRow {
  source: string;
  usedFor: string;
  terms: string;
  gate: string;
  url: string;
}

/**
 * Licence and attribution obligations that change how GODSEYE may run. Each URL was fetched on
 * the probe date recorded in docs/data-sources/pages-docs-privacy-ops.md.
 */
export const LICENCE_SUMMARY: readonly LicenceRow[] = [
  { source: 'OpenStreetMap (via OpenFreeMap tiles, Photon, Nominatim, routing engines)', usedFor: 'Basemap, geocoding, routing', terms: 'ODbL 1.0; attribution "© OpenStreetMap contributors"', gate: 'Always on; attribution in the map control', url: 'https://www.openstreetmap.org/copyright' },
  { source: 'Nominatim (OSMF public instance)', usedFor: 'Geocoding fallback', terms: 'Usage policy: ≤ 1 request/s, identifying User-Agent, cache results, no autocomplete', gate: 'One server queue (1 req/s) + 30-day cache; never from the browser', url: 'https://operations.osmfoundation.org/policies/nominatim/' },
  { source: 'OpenFreeMap', usedFor: 'Vector basemap', terms: 'No key or limits; "OpenFreeMap © OpenMapTiles Data from OpenStreetMap"', gate: 'Always on', url: 'https://openfreemap.org/' },
  { source: 'Esri World Imagery', usedFor: 'SAT basemap', terms: 'Esri Master License Agreement; attribution "Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community"; no offline tile export', gate: 'Browser tiles only, never proxied or cached', url: 'https://www.esri.com/en-us/legal/terms/full-master-agreement' },
  { source: 'NASA GIBS', usedFor: 'Night lights, true-colour imagery', terms: 'Open NASA data; GIBS acknowledgement text required', gate: 'Browser tiles; acknowledgement in attribution', url: 'https://nasa-gibs.github.io/gibs-api-docs/' },
  { source: 'AWS Terrain Tiles (Tilezen joerd)', usedFor: 'Terrain', terms: 'Attribution to the joerd data sources', gate: 'Browser tiles', url: 'https://github.com/tilezen/joerd/blob/master/docs/attribution.md' },
  { source: 'adsb.lol', usedFor: 'Live aircraft, traces', terms: 'ODbL; "Aircraft data © adsb.lol contributors, ODbL" (licence page is script-rendered; per the research pack)', gate: 'Always on (keyless default)', url: 'https://www.adsb.lol/privacy-license/' },
  { source: 'OpenSky Network', usedFor: 'Aircraft (optional)', terms: 'Terms of use require a written licence for live products', gate: 'OPENSKY_LICENSED=true + OAuth client', url: 'https://opensky-network.org/about/terms-of-use' },
  { source: 'adsb.fi open data', usedFor: 'Aircraft (optional)', terms: 'Personal, non-commercial use only; 1 request/s', gate: 'ADSBFI_PERSONAL_USE=true', url: 'https://github.com/adsbfi/opendata' },
  { source: 'VRS standing data (adsb.lol mirror)', usedFor: 'Callsign → route', terms: 'CC0', gate: 'Always on', url: 'https://github.com/vradarserver/standing-data' },
  { source: 'OurAirports', usedFor: 'Airport database', terms: 'Public domain', gate: 'Always on (build-time snapshot)', url: 'https://ourairports.com/data/' },
  { source: 'OpenFlights', usedFor: 'Historical airline routes', terms: 'ODbL; route data frozen in June 2014, labelled "historical (2014)"', gate: 'Always on, labelled historical', url: 'https://openflights.org/data.php' },
  { source: 'CelesTrak', usedFor: 'Satellite catalogue (OMM)', terms: 'Usage policy: download once per update (GP data every 2 h), stop on non-200', gate: 'Single writer, ≥ 2 h cache', url: 'https://celestrak.org/usage-policy.php' },
  { source: 'Open-Meteo', usedFor: 'Air quality, winds aloft, dossier weather', terms: 'Free tier non-commercial; data CC BY 4.0', gate: 'openmeteo capability: off when COMMERCIAL_DEPLOYMENT=true', url: 'https://open-meteo.com/en/terms' },
  { source: 'USGS earthquakes', usedFor: 'Earthquakes, ticker', terms: 'US public domain; credit USGS', gate: 'Always on', url: 'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits' },
  { source: 'gpsjam.org', usedFor: 'GPS interference (daily H3)', terms: 'Licence not stated; attributed, reuse terms unknown', gate: 'Always on with attribution; reviewed if terms appear', url: 'https://gpsjam.org/faq' },
  { source: 'GDELT 2.0', usedFor: 'Events', terms: 'Open, unrestricted use with citation', gate: 'Always on', url: 'https://www.gdeltproject.org/about.html' },
  { source: 'DeepStateMap', usedFor: 'Frontlines', terms: 'Attribution required; commercial entities may use the API only with prior approval', gate: 'NONCOMMERCIAL=true and not COMMERCIAL_DEPLOYMENT', url: 'https://deepstatemap.live/license-en.html' },
  { source: 'abuse.ch (URLhaus, Feodo Tracker, ThreatFox)', usedFor: 'Malware / C2 INDICATOR points', terms: 'Not-for-profit community data under abuse.ch terms of use; commercial use needs an agreement', gate: 'nc_sources: off when COMMERCIAL_DEPLOYMENT=true', url: 'https://abuse.ch/terms-of-use/' },
  { source: 'ip-api.com', usedFor: 'IP geolocation of indicators, OSINT IP lookups', terms: 'Free endpoint non-commercial only, 45 requests/min', gate: 'nc_sources (feeds); rate-limited lookups', url: 'https://ip-api.com/docs/legal' },
  { source: 'Shodan InternetDB', usedFor: 'Passive port/CVE lookups', terms: 'Free for non-commercial use; commercial use needs a Shodan licence (per the research pack; the docs page states no terms)', gate: 'nc_sources: off when COMMERCIAL_DEPLOYMENT=true', url: 'https://internetdb.shodan.io/docs' },
  { source: 'OpenSanctions', usedFor: 'Sanctions matches, entity graph', terms: 'CC BY-NC 4.0; commercial use needs a licence', gate: 'nc_sources: off when COMMERCIAL_DEPLOYMENT=true', url: 'https://www.opensanctions.org/licensing/' },
  { source: 'Cloudflare Radar', usedFor: 'Outages, L3 attack origins', terms: 'API token (Radar: Read); data CC BY-NC 4.0', gate: 'cloudflare: CLOUDFLARE_API_TOKEN and not COMMERCIAL_DEPLOYMENT', url: 'https://developers.cloudflare.com/radar/' },
  { source: 'TeleGeography Submarine Cable Map', usedFor: 'Cables and landing points', terms: 'CC BY-NC-SA 3.0 (confirmed via secondary sources only), attribution', gate: 'nc_sources: off when COMMERCIAL_DEPLOYMENT=true', url: 'https://www.submarinecablemap.com/' },
  { source: 'Natural Earth', usedFor: 'Ports, conflict-zone outlines', terms: 'Public domain', gate: 'Always on', url: 'https://www.naturalearthdata.com/about/terms-of-use/' },
  { source: 'Wikidata', usedFor: 'Nuclear facilities, dossier facts, entity graph', terms: 'CC0 (structured data)', gate: 'Always on', url: 'https://www.wikidata.org/wiki/Wikidata:Licensing' },
  { source: 'RainViewer', usedFor: 'Weather radar frames', terms: 'Free API with attribution link; max zoom 7', gate: 'Always on', url: 'https://www.rainviewer.com/api.html' },
  { source: 'Telegram public channels', usedFor: 'Live Alerts', terms: 'Content licensing terms prohibit using platform data to train or develop AI models', gate: 'Low-volume previews; never used for training', url: 'https://telegram.org/tos/content-licensing' },
  { source: 'TfL Unified API', usedFor: 'London cameras (optional key)', terms: 'Transport Data Service terms; "Powered by TfL Open Data"', gate: 'tfl capability (TFL_APP_KEY)', url: 'https://tfl.gov.uk/corporate/terms-and-conditions/transport-data-service' },
];

/** Agent logs in a stable order: the lead's first, then alphabetical. */
export function orderAgents(files: readonly string[]): string[] {
  const md = files.filter((f) => f.endsWith('.md'));
  return [...md].sort((a, b) => (a === 'lead.md' ? -1 : b === 'lead.md' ? 1 : a.localeCompare(b)));
}

/** Demote Markdown headings by one level (outside fenced code), capping at h6. */
export function demoteHeadings(markdown: string): string {
  let fenced = false;
  return markdown
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
      if (fenced) return line;
      const m = /^(#{1,6})(\s.*)$/.exec(line);
      return m ? `${'#'.repeat(Math.min(6, m[1]!.length + 1))}${m[2]}` : line;
    })
    .join('\n');
}

function licenceTable(rows: readonly LicenceRow[]): string {
  const esc = (s: string) => s.replace(/\|/g, '\\|');
  const out = ['| Source | Used for | Licence / terms | How GODSEYE complies | Terms |', '|---|---|---|---|---|'];
  for (const r of rows) out.push(`| ${esc(r.source)} | ${esc(r.usedFor)} | ${esc(r.terms)} | ${esc(r.gate)} | <${r.url}> |`);
  return out.join('\n');
}

export interface AgentLog {
  file: string;
  content: string;
}

/** Render docs/DATA_SOURCES.md. Pure: same logs, same bytes. */
export function compileDataSources(logs: readonly AgentLog[], licences: readonly LicenceRow[] = LICENCE_SUMMARY): string {
  const out = [
    '# GODSEYE data sources: probe log and licences',
    '',
    '<!-- Generated by tools/compile-data-sources.ts from docs/data-sources/*.md. Do not edit by hand. -->',
    '',
    'Every upstream is probed with `curl` from the build machine before it is wired, with the honest User-Agent',
    '`GODSEYE/<version> (+https://github.com/awne8886/godseye; contact …)`. Each agent keeps its own log in',
    '`docs/data-sources/<agent>.md` (URL · HTTP status · latency · CORS · auth · licence / attribution · notes, with the',
    'probe date); this file compiles them. Regenerate with',
    '`node --experimental-transform-types --import ./tools/ts-loader.mjs tools/compile-data-sources.ts`.',
    '',
    '## Licence summary',
    '',
    'Obligations that decide whether and how a source runs. `COMMERCIAL_DEPLOYMENT=true` turns every non-commercial source',
    'off; licence-gated sources stay off until the operator opts in (see `.env.example` and `/api/health`).',
    '',
    licenceTable(licences),
    '',
    '## Probe logs',
    '',
    ...logs.map((l) => `- [${l.file.replace(/\.md$/, '')}](data-sources/${l.file})`),
    '',
  ];
  for (const l of logs) {
    out.push(demoteHeadings(l.content.trim()), '');
  }
  return out.join('\n');
}

export function readLogs(dir = SOURCES_DIR): AgentLog[] {
  return orderAgents(readdirSync(dir)).map((file) => ({ file, content: readFileSync(path.join(dir, file), 'utf8') }));
}

function main(argv: string[]): number {
  const md = compileDataSources(readLogs());
  if (argv.includes('--check')) {
    let existing = '';
    try {
      existing = readFileSync(OUTPUT_PATH, 'utf8');
    } catch {
      existing = '';
    }
    if (existing === md) return 0;
    console.error('compile-data-sources: docs/DATA_SOURCES.md is out of date; run without --check to regenerate.');
    return 1;
  }
  writeFileSync(OUTPUT_PATH, md);
  console.log(`compile-data-sources: wrote docs/DATA_SOURCES.md from ${readLogs().length} probe logs`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2));
