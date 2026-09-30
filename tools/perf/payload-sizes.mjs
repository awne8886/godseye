#!/usr/bin/env node
/**
 * Payload-size checker (perf-auditor). Fetches every bulk /api route against a running server and
 * reports wire bytes with and without `Accept-Encoding: br, gzip`, the decoded size, status and time.
 * Contract §10: every /api response must stay < 4 MB (checked on the *decoded* body, which is what a
 * client without compression receives and what the browser has to parse).
 *
 *   node tools/perf/payload-sizes.mjs [--base http://127.0.0.1:3000] [--json out.json]
 *
 * Exit code 1 when any response is >= 4 MB decoded.
 */
import http from 'node:http';
import zlib from 'node:zlib';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const BASE = opt('--base', 'http://127.0.0.1:3000');
const OUT = opt('--json', null);
const LIMIT = 4 * 1024 * 1024;

const REGIONS = ['us-west', 'texas', 'us-midwest', 'canada', 'uk', 'europe', 'nordics', 'asia', 'oceania'];
const ROUTES = [
  'flights', 'satellites', 'fires', 'gdelt-events', 'gdelt', 'earthquakes', 'cables', 'live-news',
  'conflicts', 'infrastructure', 'maritime', 'gps-interference', 'outages', 'malware', 'threatfox',
  'cyber-threats', 'cyber-attacks', 'airports', 'stats', 'health', 'ticker', 'news', 'markets',
  'crypto', 'space-weather', 'iss', 'air-quality', 'gdacs', 'frontlines', 'country-risk', 'radar',
  'cloudflare-radar', 'scm-suppliers', 'weather', 'weather-radar',
  ...REGIONS.map((r) => `cctv?region=${r}`),
];

function get(path, encoding) {
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
        resolve({ status: res.statusCode, enc, wire: raw.length, decoded: decoded.length, ms: Math.round(performance.now() - t0), type: res.headers['content-type'] ?? '' });
      });
    });
    req.on('error', (e) => resolve({ status: 0, enc: '-', wire: 0, decoded: 0, ms: Math.round(performance.now() - t0), error: String(e.message) }));
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

const kb = (n) => (n / 1024).toFixed(1);
const rows = [];
let over = 0;
for (const path of ROUTES) {
  const plain = await get(path, null);
  const br = await get(path, 'br, gzip');
  const row = {
    path,
    status: plain.status,
    identityBytes: plain.wire,
    identityEncoding: plain.enc,
    brEncoding: br.enc,
    brBytes: br.wire,
    decodedBytes: Math.max(plain.decoded, br.decoded),
    msIdentity: plain.ms,
    msBr: br.ms,
    contentType: plain.type,
  };
  if (row.decodedBytes >= LIMIT) over++;
  rows.push(row);
}
rows.sort((a, b) => b.decodedBytes - a.decodedBytes);
console.log('route'.padEnd(26), 'st ', 'identity KB'.padStart(12), 'id-enc'.padStart(8), 'br/gz KB'.padStart(10), 'enc'.padStart(8), 'decoded KB'.padStart(11), 'ms(id/br)'.padStart(12), ' <4MB');
for (const r of rows) {
  console.log(
    r.path.padEnd(26),
    String(r.status).padStart(3),
    kb(r.identityBytes).padStart(12),
    r.identityEncoding.padStart(8),
    kb(r.brBytes).padStart(10),
    r.brEncoding.padStart(8),
    kb(r.decodedBytes).padStart(11),
    `${r.msIdentity}/${r.msBr}`.padStart(12),
    r.decodedBytes < LIMIT ? '  ok' : '  FAIL',
  );
}
if (OUT) writeFileSync(OUT, JSON.stringify({ base: BASE, at: new Date().toISOString(), rows }, null, 2));
console.log(over ? `\n${over} route(s) >= 4 MB decoded` : '\nall routes < 4 MB decoded');
process.exit(over ? 1 : 0);
