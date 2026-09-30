#!/usr/bin/env node
/**
 * Initial-JS budget checker (perf-auditor). Contract §10: initial JS <= 350 KB gzip, excluding lazy
 * map chunks. "Initial" = every /_next/static/*.js referenced by the server-rendered HTML of a route
 * (<script src> + preload links), i.e. what the browser must fetch/parse before hydration. Sizes are
 * gzip -9 of the served file (Next serves static chunks gzip-encoded); every chunk is fingerprinted
 * with the libraries it contains so the heavy ones can be attributed.
 *
 *   node tools/perf/bundle-size.mjs [--base http://127.0.0.1:3000] [--routes /,/docs,/privacy]
 *                                    [--chunks-dir .next/static/chunks] [--json out.json]
 *
 * Exit code 1 when any route's initial JS exceeds the budget.
 */
import zlib from 'node:zlib';
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const BASE = opt('--base', 'http://127.0.0.1:3000');
const ROUTES = opt('--routes', '/,/docs,/privacy,/?panel=layers').split(',');
const CHUNKS_DIR = opt('--chunks-dir', '.next/static/chunks');
const OUT = opt('--json', null);
const BUDGET = 350 * 1024;

// Fingerprints: substrings that only appear in a given library's bundled source.
const MARKERS = [
  ['maplibre-gl', /maplibre|MapLibre/],
  ['deck.gl', /deck\.gl|@deck\.gl|DeckGL|MapboxOverlay|MapLibreOverlay/],
  ['luma.gl', /luma\.gl|@luma\.gl/],
  ['satellite.js', /json2satrec|twoline2satrec|sgp4/],
  ['echarts', /echarts/],
  ['lightweight-charts', /lightweight-charts|LightweightCharts/],
  ['hls.js', /hls\.js|HLS\.js|Hls\.DefaultConfig/],
  ['h3-js', /h3-js|latLngToCell/],
  ['turf', /@turf|turf/],
  ['motion', /framer|motion\/react|useReducedMotion/],
  ['react-dom', /react-dom|__SECRET_INTERNALS|ReactDOM/],
  ['next-runtime', /__NEXT_DATA__|next\/dist|__next_f/],
  ['radix', /radix/i],
  ['cmdk', /cmdk/],
  ['react-query', /QueryClient|tanstack/],
  ['zod', /ZodError|zod/],
  ['minisearch', /MiniSearch/],
];

const gz = (buf) => zlib.gzipSync(buf, { level: 9 }).length;
const kb = (n) => (n / 1024).toFixed(1);

async function text(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'godseye-perf-auditor' } });
  return r.text();
}
async function buf(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'godseye-perf-auditor' } });
  return Buffer.from(await r.arrayBuffer());
}
function fingerprint(src) {
  const s = src.toString('latin1');
  return MARKERS.filter(([, re]) => re.test(s)).map(([n]) => n);
}

const result = { base: BASE, at: new Date().toISOString(), budgetBytes: BUDGET, routes: {}, largestChunks: [] };
let fail = 0;
const cache = new Map();
for (const route of ROUTES) {
  const html = await text(BASE + route);
  // Executed initial scripts: <script src> (minus noModule polyfills, which modern browsers skip)
  // plus rel=preload/modulepreload script hints.
  const tags = [...html.matchAll(/<(script|link)\b[^>]*\/_next\/static\/[^>]*>/g)].map((m) => m[0]);
  const noModule = tags.filter((t) => /noModule/i.test(t)).map((t) => t.match(/\/_next\/static\/[^"'\s]+?\.js/)?.[0]);
  const js = [...new Set(tags.filter((t) => !/noModule/i.test(t)).map((t) => t.match(/\/_next\/static\/[^"'\s]+?\.js/)?.[0]).filter(Boolean))];
  if (noModule.length) console.log(`${route}: skipping noModule ${noModule.join(', ')}`);
  const css = [...new Set([...html.matchAll(/\/_next\/static\/[^"'\s]+?\.css/g)].map((m) => m[0]))];
  let raw = 0;
  let gzip = 0;
  const chunks = [];
  for (const p of js) {
    if (!cache.has(p)) {
      const b = await buf(BASE + p);
      cache.set(p, { raw: b.length, gzip: gz(b), libs: fingerprint(b) });
    }
    const c = cache.get(p);
    raw += c.raw;
    gzip += c.gzip;
    chunks.push({ path: p, ...c });
  }
  let cssGzip = 0;
  for (const p of css) cssGzip += gz(await buf(BASE + p));
  chunks.sort((a, b) => b.gzip - a.gzip);
  const over = gzip > BUDGET;
  if (over) fail++;
  result.routes[route] = { jsCount: js.length, rawBytes: raw, gzipBytes: gzip, cssGzipBytes: cssGzip, htmlBytes: Buffer.byteLength(html), htmlGzipBytes: gz(Buffer.from(html)), overBudget: over, chunks };
  console.log(`\n${route}  initial JS: ${js.length} files, ${kb(raw)} KB raw, ${kb(gzip)} KB gzip ${over ? 'OVER' : 'ok'} (budget ${kb(BUDGET)} KB); CSS ${kb(cssGzip)} KB gz; HTML ${kb(Buffer.byteLength(html))} KB (${kb(gz(Buffer.from(html)))} KB gz)`);
  for (const c of chunks.slice(0, 12)) console.log(`  ${kb(c.gzip).padStart(7)} KB gz ${kb(c.raw).padStart(8)} KB  ${c.path.split('/').pop()}  ${c.libs.join(' ')}`);
}

if (existsSync(CHUNKS_DIR)) {
  const initial = new Set([...cache.keys()].map((p) => p.split('/').pop()));
  const files = readdirSync(CHUNKS_DIR).filter((f) => f.endsWith('.js'));
  const all = files.map((f) => {
    const full = path.join(CHUNKS_DIR, f);
    const b = readFileSync(full);
    return { file: f, raw: statSync(full).size, gzip: gz(b), libs: fingerprint(b), initial: initial.has(f) };
  });
  all.sort((a, b) => b.gzip - a.gzip);
  const total = all.reduce((s, c) => s + c.gzip, 0);
  result.largestChunks = all.slice(0, 25);
  console.log(`\nAll chunks in ${CHUNKS_DIR}: ${all.length} files, ${kb(total)} KB gzip total. Largest:`);
  for (const c of all.slice(0, 20)) console.log(`  ${kb(c.gzip).padStart(7)} KB gz ${kb(c.raw).padStart(8)} KB  ${c.initial ? 'INITIAL' : 'lazy   '} ${c.file}  ${c.libs.join(' ')}`);
}
if (OUT) writeFileSync(OUT, JSON.stringify(result, null, 2));
process.exit(fail ? 1 : 0);
