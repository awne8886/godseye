#!/usr/bin/env node
/**
 * Payload-size checker (perf-auditor). Fetches every bulk /api route against a running server and
 * reports wire bytes with no Accept-Encoding, `br, gzip` and `gzip` only (`*` = gzip not honoured), the decoded size, status and time.
 * Contract §10: every /api response must stay < 4 MB (checked on the *decoded* body, which is what a
 * client without compression receives and what the browser has to parse).
 *
 *   node tools/perf/payload-sizes.mjs [--base http://127.0.0.1:3000] [--dist .next] [--json out.json]
 *
 * Exit code 1 when any response is >= 4 MB decoded, or answers a status other than 2xx, 503 (SOURCE
 * OFFLINE) or, on a capability-gated route, 403 `capability_disabled`: a 404 or 500 means the route
 * was never measured, which must not read as "within budget".
 *
 * Exit code 2 (nothing measured) when the server at --base is not serving the build in --dist
 * (default `.next` in the current directory): a next-server left over from an older build still
 * answers /api with the old code, so its figures would be a false green. The check loads `/`, takes
 * every /_next/static/chunks/* asset it references and requires each to exist in <dist>/static/chunks,
 * requires every build id the page names to equal <dist>/BUILD_ID, and requires the server to
 * actually serve one of those chunks with 200.
 */
import http from 'node:http';
import zlib from 'node:zlib';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIMIT = 4 * 1024 * 1024;

/**
 * The camera regions, read from CCTV_REGIONS in src/features/surveillance/shared.ts so a new region
 * (e.g. `japan`, which `/` requests by default) is measured without editing this file.
 */
export function cctvRegions(source = readFileSync(fileURLToPath(new URL('../../src/features/surveillance/shared.ts', import.meta.url)), 'utf8')) {
  const m = /export const CCTV_REGIONS = \[([^\]]+)\]/.exec(source);
  if (!m) throw new Error('CCTV_REGIONS not found in src/features/surveillance/shared.ts');
  return [...m[1].matchAll(/'([a-z-]+)'/g)].map((r) => r[1]);
}

/**
 * Bulk routes and the query each is measured with (the catalogue example where it has required
 * params). Every path must exist: tools/perf/payload-sizes.test.ts checks this list against
 * API_CATALOG.
 */
export const ROUTES = [
  'flights', 'satellites', 'fires', 'gdelt-events', 'gdelt', 'earthquakes', 'cables', 'live-news',
  'conflicts', 'infrastructure', 'maritime', 'gps-interference', 'outages', 'malware', 'threatfox',
  'cyber-threats', 'cyber-attacks', 'stats', 'health', 'ticker', 'news', 'markets',
  'crypto', 'space-weather', 'iss', 'air-quality', 'gdacs', 'frontlines', 'country-risk', 'radar',
  'cloudflare-radar', 'scm-suppliers', 'weather', 'weather-radar',
  'airports/search?q=lon', 'route/plan?from=EGLL&to=KJFK', 'route/live?from=EGLL&to=KJFK&reverse=1',
  ...cctvRegions().map((r) => `cctv?region=${r}`),
];

/**
 * Routes that answer 403 `capability_disabled` while their licence or key capability is off (the
 * catalogue `capability` field; the test keeps the two equal).
 */
export const CAPABILITY_GATED = new Set(['cables', 'malware', 'threatfox', 'cyber-attacks', 'frontlines', 'cloudflare-radar']);

/** Why a measured status means the payload was not measured, or null when it was (or is a documented gate). */
export function statusProblem(path, status) {
  if (status >= 200 && status < 300) return null;
  if (status === 503) return null; // SOURCE OFFLINE: the error body is what a client receives.
  if (status === 403 && CAPABILITY_GATED.has(path.split('?')[0])) return null;
  return `unexpected status ${status || 'no response'}`;
}

function get(BASE, path, encoding) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const headers = { 'user-agent': 'godseye-perf-auditor' };
    if (encoding) headers['accept-encoding'] = encoding;
    const req = http.get(`${BASE}/api/${path}`, { headers, timeout: 120_000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        const enc = res.headers['content-encoding'] ?? 'identity';
        let decoded = raw;
        try {
          if (enc === 'br') decoded = zlib.brotliDecompressSync(raw);
          else if (enc === 'gzip') decoded = zlib.gunzipSync(raw);
          else if (enc === 'deflate') decoded = zlib.inflateSync(raw);
        } catch {
          /* keep raw */
        }
        resolve({ status: res.statusCode, vary: res.headers.vary ?? '', enc, wire: raw.length, decoded: decoded.length, ms: Math.round(performance.now() - t0), type: res.headers['content-type'] ?? '' });
      });
    });
    req.on('error', (e) => resolve({ status: 0, enc: '-', wire: 0, decoded: 0, ms: Math.round(performance.now() - t0), error: String(e.message) }));
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

/** Every /_next/static/chunks/<file> the HTML references (deduplicated, query/hash stripped, URL-decoded). */
export function chunkAssets(html) {
  const out = new Set();
  for (const m of html.matchAll(/\/_next\/static\/chunks\/([^"'\s?#\\)]+)/g)) out.add(decodeURIComponent(m[1]));
  return [...out];
}

/**
 * Build ids the HTML names: the App Router flight payload's `"b":"<buildId>"` (JSON-escaped inside
 * the inline `self.__next_f.push` scripts) and any /_next/static/<buildId>/_buildManifest path.
 */
export function buildIdsIn(html) {
  const out = new Set();
  for (const m of html.matchAll(/\\*"b\\*":\\*"([A-Za-z0-9_-]{6,})\\*"/g)) out.add(m[1]);
  for (const m of html.matchAll(/\/_next\/static\/([A-Za-z0-9_-]{6,})\/_(?:buildManifest|ssgManifest|clientMiddlewareManifest)/g)) out.add(m[1]);
  return [...out];
}

/**
 * Why the page the server returned for `/` does not belong to the local build, or null when it does.
 * `localChunks` is the set of file paths under <dist>/static/chunks ('/'-separated, relative).
 */
export function staleBuildProblem({ status, html, localChunks, localBuildId }) {
  if (status !== 200) return `GET / answered ${status || 'no response'}, cannot tell which build the server runs`;
  const chunks = chunkAssets(html);
  if (chunks.length === 0) return 'GET / references no /_next/static/chunks assets, cannot tell which build the server runs';
  const missing = chunks.filter((c) => !localChunks.has(c));
  if (missing.length) return `server is not serving this build: ${missing.length}/${chunks.length} chunk(s) its page references are not in the local build (e.g. ${missing[0]})`;
  const ids = buildIdsIn(html);
  if (!ids.includes(localBuildId)) {
    return ids.length
      ? `server is not serving this build: its page names build id ${ids[0]}, local BUILD_ID is ${localBuildId}`
      : `GET / names no build id, cannot confirm the server runs build ${localBuildId}`;
  }
  return null;
}

function listFiles(dir, prefix = '') {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listFiles(join(dir, e.name), rel));
    else out.push(rel);
  }
  return out;
}

/** The local build: its chunk file set and BUILD_ID. Throws when `dist` holds no production build. */
export function readLocalBuild(dist) {
  const chunksDir = join(dist, 'static', 'chunks');
  const idFile = join(dist, 'BUILD_ID');
  if (!existsSync(chunksDir) || !existsSync(idFile)) throw new Error(`no production build in ${dist} (run pnpm build, or pass --dist <dir>)`);
  return { localChunks: new Set(listFiles(chunksDir)), localBuildId: readFileSync(idFile, 'utf8').trim() };
}

function getRaw(url, accept) {
  return new Promise((done) => {
    const req = http.get(url, { headers: { 'user-agent': 'godseye-perf-auditor', accept }, timeout: 120_000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => done({ status: res.statusCode ?? 0, html: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', () => done({ status: 0, html: '' }));
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

/** Exit-2 reason when the server at BASE is not running the build in DIST, else null. */
export async function verifyServedBuild(BASE, DIST) {
  let local;
  try {
    local = readLocalBuild(DIST);
  } catch (e) {
    return e.message;
  }
  const page = await getRaw(`${BASE}/`, 'text/html');
  const stale = staleBuildProblem({ ...page, ...local });
  if (stale) return stale;
  // The page can come from a cache in front of a dead server; the assets must load from this one.
  const first = chunkAssets(page.html)[0];
  const asset = await getRaw(`${BASE}/_next/static/chunks/${first}`, '*/*');
  if (asset.status !== 200) return `server is not serving this build: /_next/static/chunks/${first} answered ${asset.status || 'no response'}`;
  return null;
}

const kb = (n) => (n / 1024).toFixed(1);

async function main() {
  const args = process.argv.slice(2);
  const opt = (k, d) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : d;
  };
  const BASE = opt('--base', 'http://127.0.0.1:3000');
  const OUT = opt('--json', null);
  const DIST = resolve(opt('--dist', '.next'));
  const stale = await verifyServedBuild(BASE, DIST);
  if (stale) {
    console.error(`payload-sizes: ${stale} (base ${BASE}, dist ${DIST}). Stop the old server and start this build; nothing measured.`);
    process.exit(2);
  }
  console.log(`build ${readFileSync(join(DIST, 'BUILD_ID'), 'utf8').trim()} verified at ${BASE}`);
  const rows = [];
  let over = 0;
  let broken = 0;
  for (const path of ROUTES) {
    const plain = await get(BASE, path, null);
    const br = await get(BASE, path, 'br, gzip');
    const gz = await get(BASE, path, 'gzip');
    const row = {
      path,
      status: plain.status,
      identityBytes: plain.wire,
      identityEncoding: plain.enc,
      brEncoding: br.enc,
      brBytes: br.wire,
      gzipEncoding: gz.enc,
      gzipBytes: gz.wire,
      vary: br.vary,
      decodedBytes: Math.max(plain.decoded, br.decoded),
      msIdentity: plain.ms,
      msBr: br.ms,
      contentType: plain.type,
    };
    row.problem = statusProblem(path, row.status);
    if (row.problem) broken++;
    if (row.decodedBytes >= LIMIT) over++;
    rows.push(row);
  }
  rows.sort((a, b) => b.decodedBytes - a.decodedBytes);
  console.log('route'.padEnd(40), 'st ', 'identity KB'.padStart(12), 'id-enc'.padStart(8), 'br/gz KB'.padStart(10), 'enc'.padStart(8), 'gzip KB'.padStart(9), 'decoded KB'.padStart(11), 'ms(id/br)'.padStart(12), ' <4MB');
  for (const r of rows) {
    console.log(
      r.path.padEnd(40),
      String(r.status).padStart(3),
      kb(r.identityBytes).padStart(12),
      r.identityEncoding.padStart(8),
      kb(r.brBytes).padStart(10),
      r.brEncoding.padStart(8),
      `${kb(r.gzipBytes)}${r.gzipEncoding === 'gzip' ? '' : '*'}`.padStart(9),
      kb(r.decodedBytes).padStart(11),
      `${r.msIdentity}/${r.msBr}`.padStart(12),
      r.decodedBytes < LIMIT ? (r.problem ? `  FAIL ${r.problem}` : '  ok') : '  FAIL',
    );
  }
  if (OUT) writeFileSync(OUT, JSON.stringify({ base: BASE, at: new Date().toISOString(), rows }, null, 2));
  console.log(over ? `\n${over} route(s) >= 4 MB decoded` : '\nall routes < 4 MB decoded');
  if (broken) console.log(`${broken} route(s) not measured (unexpected status)`);
  process.exit(over || broken ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
