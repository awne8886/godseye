#!/usr/bin/env node
/**
 * Initial-JS budget (contract §10: initial JS <= 350 KB gzip, excluding the lazy map chunks).
 * "Initial" = every /_next/static/**.js the browser fetches for `/` from navigation until the page
 * is idle (no new script for --quiet-ms after network idle, at most --max-ms): what a visitor
 * downloads and parses at start-up, hydration and the default-on layers included. Sizes are gzip -9
 * of each file as served. maplibre-gl, deck.gl and luma.gl modules are removed from each chunk
 * before measuring (tools/perf/bundle-attribution.mjs: content attribution, conservative, so the
 * reported figure can only be too high). The exit code is 1 over budget, and 2 when the run is
 * invalid (`runProblems`: the map never reached data-map-ready, a script body could not be read, or
 * no deck.gl module was seen): a page whose map never loaded must not pass as "within budget".
 * HTTPS_PROXY is honoured as in playwright.config.ts (local/sandbox egress; CI has none).
 *
 *   node tools/perf/bundle-size.mjs [--base http://127.0.0.1:3100] [--route /] [--start] [--port 3100]
 *                                    [--budget-kb 350] [--quiet-ms 3000] [--max-ms 90000] [--json out.json]
 *
 * --start runs `next start -p <port>` on the current build for the measurement and stops it after.
 * Chromium: PLAYWRIGHT_CHROMIUM_EXECUTABLE if set, else Playwright's own (SwiftShader WebGL flags as
 * in playwright.config.ts, so the map path loads exactly as in e2e). Owner: map-engine.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { budgetReport, libraryLiteralSets, measureChunk, runProblems } from './bundle-attribution.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const PORT = Number(opt('--port', '3100'));
const START = args.includes('--start');
const BASE = opt('--base', `http://127.0.0.1:${PORT}`);
const ROUTE = opt('--route', '/');
const BUDGET = Number(opt('--budget-kb', '350')) * 1024;
const QUIET_MS = Number(opt('--quiet-ms', '3000'));
const MAX_MS = Number(opt('--max-ms', '90000'));
const OUT = opt('--json', null);
const kb = (n) => (n / 1024).toFixed(1);

async function waitForServer(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'GODSEYE-perf-bundle-size' } });
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server at ${url} did not answer within ${ms} ms`);
}

let server = null;
if (START) {
  const nextBin = path.join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next');
  server = spawn(process.execPath, [nextBin, 'start', '-p', String(PORT), '-H', '127.0.0.1'], { stdio: 'ignore', env: process.env });
  await waitForServer(`${BASE}/api/health`, 60_000);
}

const sets = libraryLiteralSets(path.join(process.cwd(), 'node_modules'));
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
  // The basemap style and tiles come from third-party hosts: route them through the egress proxy
  // when there is one (the app server itself is local).
  ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } } : {}),
});
const chunks = new Map();
const failedBodies = [];
let mapReady = false;
let lastScriptAt = Date.now();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: process.env.E2E_IGNORE_HTTPS_ERRORS === '1' });
  const page = await ctx.newPage();
  const pending = [];
  page.on('response', (res) => {
    const u = new URL(res.url());
    if (u.origin !== new URL(BASE).origin || !u.pathname.startsWith('/_next/static/') || !u.pathname.endsWith('.js')) return;
    if (chunks.has(u.pathname)) return;
    lastScriptAt = Date.now();
    chunks.set(u.pathname, null);
    pending.push(
      res
        .body()
        .then((b) => chunks.set(u.pathname, measureChunk(u.pathname, b.toString('utf8'), sets)))
        .catch(() => {
          chunks.delete(u.pathname);
          failedBodies.push(u.pathname);
        }),
    );
  });
  const t0 = Date.now();
  await page.goto(BASE + ROUTE, { waitUntil: 'load', timeout: MAX_MS });
  mapReady = await page
    .locator('[data-testid="map-root"] .maplibregl-map[data-map-ready="true"]')
    .waitFor({ state: 'attached', timeout: Math.max(1000, MAX_MS - (Date.now() - t0)) })
    .then(
      () => true,
      () => false,
    );
  // Idle: network idle, then no new script for QUIET_MS (lazy chunks of default-on layers included).
  while (Date.now() - t0 < MAX_MS) {
    await page.waitForLoadState('networkidle', { timeout: Math.max(1000, MAX_MS - (Date.now() - t0)) }).catch(() => undefined);
    if (Date.now() - lastScriptAt >= QUIET_MS) break;
    await page.waitForTimeout(500);
  }
  await Promise.all(pending);
} finally {
  await browser.close();
  server?.kill('SIGTERM');
}

const measured = [...chunks.values()].filter(Boolean).sort((a, b) => b.countedGzip - a.countedGzip);
const report = { base: BASE, route: ROUTE, at: new Date().toISOString(), ...budgetReport(measured, BUDGET), chunks: measured };
const excluded = Object.entries(report.excludedRawBytes)
  .map(([lib, n]) => `${lib} ${kb(n)} KB raw`)
  .join(', ');
console.log(
  `${ROUTE} initial JS until idle: ${report.files} files, ${kb(report.gzipBytes)} KB gzip fetched; ` +
    `${kb(report.countedGzipBytes)} KB gzip counted (maplibre/deck/luma removed: ${excluded || 'none found'}) ` +
    `${report.over ? 'OVER' : 'within'} budget ${kb(BUDGET)} KB`,
);
for (const c of measured.slice(0, 15)) {
  const lib = Object.keys(c.excludedRaw).join('+');
  console.log(`  ${kb(c.countedGzip).padStart(7)} KB gz counted ${kb(c.gzip).padStart(7)} KB gz served  ${c.url.split('/').pop()}${lib ? `  (${lib} removed)` : ''}`);
}
if (report.unsplitFiles.length) console.log(`  counted whole (not a module chunk): ${report.unsplitFiles.map((u) => u.split('/').pop()).join(', ')}`);
const problems = runProblems({ mapReady, failedBodies, report });
for (const p of problems) console.error(`INVALID RUN: ${p}`);
if (OUT) writeFileSync(OUT, JSON.stringify({ ...report, valid: problems.length === 0, problems }, null, 2));
process.exit(problems.length ? 2 : report.over ? 1 : 0);
