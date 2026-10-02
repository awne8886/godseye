#!/usr/bin/env node
/**
 * Payload-size checker (perf-auditor). Fetches every bulk /api route against a running server and
 * reports wire bytes with no Accept-Encoding, `br, gzip` and `gzip` only (`*` = gzip not honoured), the decoded size, status and time.
 * Contract §10: every /api response must stay < 4 MB (checked on the *decoded* body, which is what a
 * client without compression receives and what the browser has to parse).
 *
 *   node tools/perf/payload-sizes.mjs [--base http://127.0.0.1:3000] [--json out.json]
 *
 * Exit code 1 when any response is >= 4 MB decoded, or answers a status other than 2xx, 503 (SOURCE
 * OFFLINE) or, on a capability-gated route, 403 `capability_disabled`: a 404 or 500 means the route
 * was never measured, which must not read as "within budget".
 */
import http from 'node:http';
import zlib from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';
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

const kb = (n) => (n / 1024).toFixed(1);

async function main() {
  const args = process.argv.slice(2);
  const opt = (k, d) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : d;
  };
  const BASE = opt('--base', 'http://127.0.0.1:3000');
  const OUT = opt('--json', null);
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
