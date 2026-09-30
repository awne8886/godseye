#!/usr/bin/env node
/**
 * Lighthouse runner (perf-auditor). Same settings as lighthouserc.json (desktop preset,
 * pauseAfterLoadMs 9000, SwiftShader GL), N runs per URL, median by performance score, and the
 * diagnostics needed to attribute a miss: main-thread breakdown, script boot-up per URL, long tasks,
 * LCP element, layout shifts, failing accessibility audits.
 *
 *   node tools/perf/lighthouse.mjs --base http://127.0.0.1:3000 --paths /,/docs,/privacy,/?panel=layers \
 *        [--runs 3] [--preset desktop|mobile] [--out dir] [--proxy http://host:port]
 *
 * Uses the lighthouse + chrome-launcher copies that @lhci/cli installs (node_modules/.pnpm).
 * CHROME_PATH defaults to /opt/pw-browsers/chromium. Exit code 1 when a median misses §11.
 */
import { readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const BASE = opt('--base', 'http://127.0.0.1:3000');
const PATHS = opt('--paths', '/,/docs,/privacy,/?panel=layers').split(',');
const RUNS = Number(opt('--runs', '3'));
const PRESET = opt('--preset', 'desktop');
const OUT = opt('--out', '.lighthouse-perf');
const PROXY = opt('--proxy', process.env.HTTPS_PROXY ?? '');
const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium';

function pnpmPkg(prefix, name) {
  const root = path.resolve('node_modules/.pnpm');
  const dirs = readdirSync(root).filter((d) => d.startsWith(prefix)).sort().reverse();
  for (const d of dirs) {
    const p = path.join(root, d, 'node_modules', name);
    if (existsSync(p)) return p;
  }
  throw new Error(`${name} not found under node_modules/.pnpm (install @lhci/cli)`);
}
const lhDir = pnpmPkg('lighthouse@', 'lighthouse');
const clDir = pnpmPkg('chrome-launcher@1', 'chrome-launcher');
const { default: lighthouse } = await import(pathToFileURL(path.join(lhDir, 'core/index.js')).href);
const { default: desktopConfig } = await import(pathToFileURL(path.join(lhDir, 'core/config/desktop-config.js')).href);
const chromeLauncher = await import(pathToFileURL(path.join(clDir, 'dist/index.js')).href);

const chromeFlags = ['--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--ignore-certificate-errors'];
if (PROXY) chromeFlags.push(`--proxy-server=${PROXY}`);

const config =
  PRESET === 'desktop'
    ? { ...desktopConfig, settings: { ...desktopConfig.settings, pauseAfterLoadMs: 9000, onlyCategories: ['performance', 'accessibility'] } }
    : { extends: 'lighthouse:default', settings: { pauseAfterLoadMs: 9000, onlyCategories: ['performance', 'accessibility'] } };

// Lighthouse 12 leaves a dangling `checkForQuiet` evaluate that rejects ("Target closed" / "Promise
// was collected") once Chrome is killed after a finished run; it is not a run failure.
process.on('unhandledRejection', (e) => console.log(`(ignored late rejection: ${String(e?.message ?? e).slice(0, 120)})`));

const THRESH = { perf: 0.85, a11y: 1, lcp: 2500, cls: 0.1, tbt: 300 };
mkdirSync(OUT, { recursive: true });
const summary = [];
let fail = 0;

function digest(lhr) {
  const a = lhr.audits;
  const n = (id) => a[id]?.numericValue ?? null;
  const items = (id) => a[id]?.details?.items ?? [];
  return {
    perf: lhr.categories.performance?.score,
    a11y: lhr.categories.accessibility?.score,
    fcp: n('first-contentful-paint'),
    lcp: n('largest-contentful-paint'),
    tbt: n('total-blocking-time'),
    cls: n('cumulative-layout-shift'),
    si: n('speed-index'),
    tti: n('interactive'),
    mainThreadMs: n('mainthread-work-breakdown'),
    bootupMs: n('bootup-time'),
    breakdown: items('mainthread-work-breakdown').map((i) => ({ group: i.groupLabel ?? i.group, ms: Math.round(i.duration) })),
    bootup: items('bootup-time').slice(0, 12).map((i) => ({ url: i.url, total: Math.round(i.total), scripting: Math.round(i.scripting), parse: Math.round(i.scriptParseCompile) })),
    longTasks: items('long-tasks').slice(0, 15).map((i) => ({ url: i.url, start: Math.round(i.startTime), ms: Math.round(i.duration) })),
    lcpElement: items('largest-contentful-paint-element')[0]?.items?.[0]?.node?.snippet ?? a['largest-contentful-paint-element']?.details?.items?.[0]?.node?.snippet ?? null,
    lcpPhases: items('largest-contentful-paint-element')[1]?.items ?? null,
    layoutShifts: items('layout-shifts').slice(0, 5).map((i) => ({ score: i.score, node: i.node?.snippet?.slice(0, 160) })),
    totalBytes: n('total-byte-weight'),
    a11yFailures: Object.values(lhr.categories.accessibility?.auditRefs ?? [])
      .map((r) => a[r.id])
      .filter((x) => x && x.score === 0)
      .map((x) => ({ id: x.id, n: x.details?.items?.length ?? 0, sample: x.details?.items?.[0]?.node?.snippet?.slice(0, 160) })),
    runtimeError: lhr.runtimeError?.code ?? null,
    warnings: lhr.runWarnings,
  };
}

for (const p of PATHS) {
  const url = BASE + p;
  const runs = [];
  for (let i = 0, attempts = 0; i < RUNS && attempts < RUNS * 3; attempts++) {
    const chrome = await chromeLauncher.launch({ chromePath: CHROME, chromeFlags });
    try {
      const res = await lighthouse(url, { port: chrome.port, output: 'json', logLevel: 'error' }, config);
      const d = digest(res.lhr);
      if (d.runtimeError || d.perf == null) throw new Error(`runtimeError ${d.runtimeError}`);
      runs.push(d);
      const slug = `${PRESET}-${p.replace(/[^a-z0-9]+/gi, '_') || 'root'}-${i}`;
      writeFileSync(path.join(OUT, `${slug}.json`), res.report);
      console.log(`${PRESET} ${p} run ${i}: perf ${d.perf} a11y ${d.a11y} LCP ${Math.round(d.lcp)} TBT ${Math.round(d.tbt)} CLS ${d.cls?.toFixed(3)} FCP ${Math.round(d.fcp)} mainThread ${Math.round(d.mainThreadMs)}ms`);
      i++;
    } catch (e) {
      // Recorded, not hidden: a crashed/aborted run is retried and reported in the log.
      console.log(`${PRESET} ${p} attempt ${attempts} failed: ${String(e.message).slice(0, 200)}`);
    } finally {
      await chrome.kill();
    }
  }
  if (!runs.length) {
    summary.push({ path: p, preset: PRESET, median: null, runs: [], passes: false });
    fail++;
    continue;
  }
  const sorted = [...runs].sort((a, b) => (a.perf ?? 0) - (b.perf ?? 0));
  const med = sorted[Math.floor(sorted.length / 2)];
  const ok = PRESET !== 'desktop' || (med.perf >= THRESH.perf && med.a11y >= THRESH.a11y && med.lcp <= THRESH.lcp && med.cls <= THRESH.cls && med.tbt <= THRESH.tbt);
  if (!ok) fail++;
  summary.push({ path: p, preset: PRESET, median: med, runs: runs.map((r) => ({ perf: r.perf, a11y: r.a11y, lcp: r.lcp, tbt: r.tbt, cls: r.cls, fcp: r.fcp })), passes: ok });
}
writeFileSync(path.join(OUT, `summary-${PRESET}.json`), JSON.stringify(summary, null, 2));
console.log('\npath                 perf  a11y   LCP ms  TBT ms   CLS    FCP ms  pass');
for (const s of summary) {
  const m = s.median;
  if (!m) {
    console.log(`${s.path.padEnd(20)} no successful run`);
    continue;
  }
  console.log(`${s.path.padEnd(20)} ${String(m.perf).padEnd(5)} ${String(m.a11y).padEnd(5)} ${String(Math.round(m.lcp)).padStart(7)} ${String(Math.round(m.tbt)).padStart(7)} ${m.cls.toFixed(3).padStart(6)} ${String(Math.round(m.fcp)).padStart(8)}  ${s.passes ? 'yes' : 'NO'}`);
}
process.exit(fail ? 1 : 0);
