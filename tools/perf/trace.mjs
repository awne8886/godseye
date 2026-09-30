#!/usr/bin/env node
/**
 * Load + polling trace analyser (perf-auditor).
 *
 * Phase 1 (load): CPU profile + devtools timeline trace from navigation to --load-s seconds.
 *   -> main-thread busy/idle, long tasks, trace-event category breakdown (scripting, JSON parse,
 *      GC, style/layout, paint, WebGL/GPU commands, compile), top self-time functions with the
 *      chunk + source snippet they live in (so minified code can be attributed).
 * Phase 2 (polling): trace for --poll-s seconds with the app idle on its default layers.
 *   -> main-thread idle % (wall and thread-CPU based), long tasks, rAF fps.
 * Phase 3 (soak): JS heap + DOM node samples every 15 s for --soak-s seconds (memory growth).
 * Real feeds only: entity counts are read from the /api responses the page itself received.
 *
 *   node tools/perf/trace.mjs --url http://127.0.0.1:3000/ [--load-s 25] [--poll-s 60] [--soak-s 300]
 *        [--out dir] [--proxy http://host:port]
 */
import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const URL_ = opt('--url', 'http://127.0.0.1:3000/');
const LOAD_S = Number(opt('--load-s', '25'));
const POLL_S = Number(opt('--poll-s', '60'));
const SOAK_S = Number(opt('--soak-s', '300'));
const OUT = opt('--out', '.perf-trace');
const PROXY = opt('--proxy', process.env.HTTPS_PROXY ?? '');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? '/opt/pw-browsers/chromium',
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
  proxy: PROXY ? { server: PROXY, bypass: 'localhost,127.0.0.1' } : undefined,
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1350, height: 940 } });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);

// ---- entity counts + JS request log (real feeds only) ----
const counts = {};
const jsRequests = [];
let loadDone = false;
page.on('response', async (res) => {
  const u = new URL(res.url());
  if (u.pathname.endsWith('.js') && u.pathname.startsWith('/_next/')) {
    let size = 0;
    try {
      size = (await res.body()).length;
    } catch {
      /* ignore */
    }
    jsRequests.push({ path: u.pathname, afterLoad: loadDone, t: Date.now(), size });
  }
  if (!u.pathname.startsWith('/api/')) return;
  try {
    const ct = res.headers()['content-type'] ?? '';
    if (!ct.includes('json')) return;
    const body = await res.body();
    const j = JSON.parse(body.toString('utf8'));
    const n = Array.isArray(j.rows) ? j.rows.length : Array.isArray(j.features) ? j.features.length : Array.isArray(j.items) ? j.items.length : Array.isArray(j.events) ? j.events.length : null;
    const key = u.pathname + (u.searchParams.get('region') ? `?region=${u.searchParams.get('region')}` : '');
    counts[key] = { status: res.status(), entities: n, bytes: body.length, fetches: (counts[key]?.fetches ?? 0) + 1 };
  } catch {
    /* non-JSON or aborted */
  }
});

// ---- synchronous GL call accounting (which library blocks the main thread on the GPU process) ----
await page.addInitScript(() => {
  // LCP candidate history: which element became LCP when (explains a render-delay-bound LCP).
  window.__lcp = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const el = e.element;
        window.__lcp.push({ t: Math.round(e.startTime), size: e.size, tag: el?.tagName ?? null, cls: (el?.className?.baseVal ?? el?.className ?? '').toString().slice(0, 80), text: (el?.textContent ?? '').slice(0, 60), url: e.url || null });
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {
    /* unsupported */
  }
  const stats = (window.__glStats = {});
  const WRAP = ['linkProgram', 'getProgramParameter', 'compileShader', 'getShaderParameter', 'getParameter', 'getExtension', 'getSupportedExtensions', 'readPixels', 'getError', 'finish', 'getProgramInfoLog', 'getActiveUniform', 'getActiveAttrib', 'getUniformLocation', 'getAttribLocation', 'bufferData', 'texImage2D', 'getActiveUniformBlockParameter', 'getUniformBlockIndex', 'getTransformFeedbackVarying'];
  const caller = () => {
    const s = new Error().stack?.split('\n') ?? [];
    for (const l of s.slice(3)) {
      const m = l.match(/\/_next\/static\/chunks\/([^:)]+)/);
      if (m) return m[1];
    }
    return 'other';
  };
  for (const proto of [window.WebGL2RenderingContext?.prototype, window.WebGLRenderingContext?.prototype]) {
    if (!proto) continue;
    for (const name of WRAP) {
      const orig = proto[name];
      if (typeof orig !== 'function') continue;
      proto[name] = function (...a) {
        const t = performance.now();
        const r = orig.apply(this, a);
        const dt = performance.now() - t;
        if (dt >= 0.5) {
          const k = `${name}|${caller()}`;
          const e = (stats[k] ??= { n: 0, ms: 0, max: 0 });
          e.n++;
          e.ms += dt;
          e.max = Math.max(e.max, dt);
        }
        return r;
      };
    }
  }
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const t = performance.now();
    const r = origGetContext.call(this, type, ...rest);
    const dt = performance.now() - t;
    if (/webgl/.test(type)) {
      const k = `getContext(${type})|${caller()}`;
      const e = (stats[k] ??= { n: 0, ms: 0, max: 0 });
      e.n++;
      e.ms += dt;
      e.max = Math.max(e.max, dt);
    }
    return r;
  };
});
const glSnapshot = async () => {
  const s = await page.evaluate(() => window.__glStats ?? {});
  return Object.entries(s)
    .map(([k, v]) => ({ call: k, n: v.n, ms: Math.round(v.ms), max: Math.round(v.max) }))
    .sort((a, b) => b.ms - a.ms);
};

// ---- trace helpers ----
const CATS = ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'v8.execute', 'v8', 'blink.user_timing', 'toplevel', 'gpu', 'disabled-by-default-v8.compile', 'loading'].join(',');
async function startTrace() {
  await cdp.send('Tracing.start', { categories: CATS, transferMode: 'ReturnAsStream' });
}
async function stopTrace() {
  const done = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));
  await cdp.send('Tracing.end');
  const { stream } = await done;
  let data = '';
  for (;;) {
    const r = await cdp.send('IO.read', { handle: stream });
    data += r.base64Encoded ? Buffer.from(r.data, 'base64').toString('utf8') : r.data;
    if (r.eof) break;
  }
  await cdp.send('IO.close', { handle: stream });
  const parsed = JSON.parse(data);
  return Array.isArray(parsed) ? parsed : parsed.traceEvents;
}

function rendererMain(events) {
  // The renderer main thread = the CrRendererMain thread of the process that ran the page.
  const names = events.filter((e) => e.ph === 'M' && e.name === 'thread_name' && e.args?.name === 'CrRendererMain');
  let best = null;
  let bestN = -1;
  for (const t of names) {
    const n = events.filter((e) => e.pid === t.pid && e.tid === t.tid && e.ph === 'X').length;
    if (n > bestN) {
      best = t;
      bestN = n;
    }
  }
  return best;
}

const GROUPS = {
  scripting: ['FunctionCall', 'EvaluateScript', 'v8.evaluateModule', 'TimerFire', 'EventDispatch', 'FireAnimationFrame', 'RunMicrotasks', 'V8.Execute', 'v8.run', 'FireIdleCallback', 'XHRReadyStateChange', 'XHRLoad', 'MessagePort'],
  jsonParse: ['v8.parseOnBackground', 'JSON.parse', 'V8.ParseJSON'],
  compile: ['v8.compile', 'V8.CompileCode', 'v8.compileModule', 'CompileScript', 'CacheScript', 'v8.produceCache', 'V8.CompileLazy', 'v8.compileLazy'],
  gc: ['MinorGC', 'MajorGC', 'V8.GCScavenger', 'V8.GCIncrementalMarking', 'V8.GCFinalizeMC', 'BlinkGC.AtomicPhase', 'ThreadState::performIdleLazySweep', 'V8.GC_MC_BACKGROUND_EVACUATE_COPY', 'GCEvent', 'BlinkGC'],
  styleLayout: ['UpdateLayoutTree', 'Layout', 'RecalculateStyles', 'UpdateLayerTree', 'HitTest', 'ScheduleStyleRecalculation', 'InvalidateLayout', 'ParseAuthorStyleSheet'],
  paint: ['Paint', 'PaintImage', 'CompositeLayers', 'RasterTask', 'Decode Image', 'ImageDecodeTask', 'PrePaint', 'Commit', 'Layerize'],
  parseHTML: ['ParseHTML'],
};
const GROUP_OF = new Map(Object.entries(GROUPS).flatMap(([g, ns]) => ns.map((n) => [n, g])));

function analyse(events, label) {
  const main = rendererMain(events);
  if (!main) return { label, error: 'no renderer main thread' };
  const mine = events.filter((e) => e.pid === main.pid && e.tid === main.tid);
  const ts = mine.filter((e) => e.ts).map((e) => e.ts);
  const t0 = Math.min(...ts);
  const t1 = Math.max(...mine.filter((e) => e.ph === 'X').map((e) => e.ts + (e.dur ?? 0)));
  const windowMs = (t1 - t0) / 1000;
  const tasks = mine.filter((e) => e.ph === 'X' && (e.name === 'RunTask' || e.name === 'ThreadControllerImpl::RunTask') && e.dur);
  let busy = 0;
  let busyCpu = 0;
  const long = [];
  let lastEnd = 0;
  for (const t of tasks.sort((a, b) => a.ts - b.ts)) {
    if (t.ts < lastEnd) continue; // nested
    lastEnd = t.ts + t.dur;
    busy += t.dur;
    busyCpu += t.tdur ?? t.dur;
    if (t.dur > 50_000) long.push({ startMs: Math.round((t.ts - t0) / 1000), ms: Math.round(t.dur / 1000), cpuMs: Math.round((t.tdur ?? t.dur) / 1000) });
  }
  // self-time per event name (children subtracted) for category breakdown
  const xs = mine.filter((e) => e.ph === 'X' && e.dur).sort((a, b) => a.ts - b.ts || b.dur - a.dur);
  const self = new Map();
  const stack = [];
  for (const e of xs) {
    while (stack.length && stack[stack.length - 1].end <= e.ts) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) self.set(parent.e, (self.get(parent.e) ?? 0) - Math.min(e.dur, parent.end - e.ts));
    self.set(e, (self.get(e) ?? 0) + e.dur);
    stack.push({ e, end: e.ts + e.dur });
  }
  const byName = new Map();
  const byGroup = {};
  for (const [e, us] of self) {
    if (e.name === 'RunTask' || e.name === 'ThreadControllerImpl::RunTask') continue;
    byName.set(e.name, (byName.get(e.name) ?? 0) + us);
    const g = GROUP_OF.get(e.name) ?? (/GC/i.test(e.name) ? 'gc' : /gpu|WebGL|GLES|Gpu/i.test(e.name) ? 'gpu' : 'other');
    byGroup[g] = (byGroup[g] ?? 0) + us;
  }
  const topNames = [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([n, us]) => ({ name: n, ms: Math.round(us / 1000) }));
  const fps = mine.filter((e) => e.name === 'FireAnimationFrame').length / (windowMs / 1000);
  const tbtLike = long.reduce((s, t) => s + (t.ms - 50), 0);
  return {
    label,
    windowMs: Math.round(windowMs),
    busyMs: Math.round(busy / 1000),
    busyCpuMs: Math.round(busyCpu / 1000),
    idlePct: +(100 - (100 * busy) / 1000 / windowMs).toFixed(1),
    idlePctCpu: +(100 - (100 * busyCpu) / 1000 / windowMs).toFixed(1),
    longTasks: long.length,
    longTaskMs: long.reduce((s, t) => s + t.ms, 0),
    blockingMs: tbtLike,
    longest: long.sort((a, b) => b.ms - a.ms).slice(0, 10),
    groupsMs: Object.fromEntries(Object.entries(byGroup).map(([k, v]) => [k, Math.round(v / 1000)]).sort((a, b) => b[1] - a[1])),
    topEventNames: topNames,
    rafPerSec: +fps.toFixed(1),
  };
}

// ---- CPU profile helpers ----
const sources = new Map();
async function snippet(url, line, col) {
  if (!url || !url.includes('/_next/')) return '';
  if (!sources.has(url)) {
    try {
      sources.set(url, await (await fetch(url)).text());
    } catch {
      sources.set(url, '');
    }
  }
  const lines = sources.get(url).split('\n');
  const l = lines[line] ?? '';
  return l.slice(Math.max(0, col - 40), col + 140).replace(/\s+/g, ' ');
}
async function profileTop(profile, n = 40) {
  const nodes = new Map(profile.nodes.map((x) => [x.id, x]));
  const selfUs = new Map();
  const dt = profile.timeDeltas;
  for (let i = 0; i < profile.samples.length; i++) selfUs.set(profile.samples[i], (selfUs.get(profile.samples[i]) ?? 0) + (dt[i] ?? 0));
  const agg = new Map();
  const byUrl = new Map();
  let total = 0;
  for (const [id, us] of selfUs) {
    const cf = nodes.get(id).callFrame;
    if (cf.functionName === '(idle)' || cf.functionName === '(program)') continue;
    total += us;
    const key = `${cf.functionName || '(anon)'}|${cf.url}|${cf.lineNumber}|${cf.columnNumber}`;
    agg.set(key, (agg.get(key) ?? 0) + us);
    const u = cf.url ? cf.url.replace(/^https?:\/\/[^/]+/, '') : cf.functionName;
    byUrl.set(u, (byUrl.get(u) ?? 0) + us);
  }
  const top = [];
  for (const [key, us] of [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)) {
    const [fn, url, line, col] = key.split('|');
    top.push({ fn, url: url.replace(/^https?:\/\/[^/]+/, ''), line: +line, col: +col, ms: Math.round(us / 1000), code: await snippet(url, +line, +col) });
  }
  return {
    activeMs: Math.round(total / 1000),
    byUrl: [...byUrl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([u, us]) => ({ url: u, ms: Math.round(us / 1000) })),
    top,
  };
}

// ---- Phase 1: load ----
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
await cdp.send('Performance.enable');
await startTrace();
await cdp.send('Profiler.start');
const tNav = Date.now();
await page.goto(URL_, { waitUntil: 'load', timeout: 120_000 });
const loadEventMs = Date.now() - tNav;
await page.waitForTimeout(LOAD_S * 1000);
loadDone = true;
const { profile } = await cdp.send('Profiler.stop');
const loadTrace = await stopTrace();
const load = analyse(loadTrace, `load 0-${LOAD_S}s`);
load.loadEventMs = loadEventMs;
load.profile = await profileTop(profile);
load.gl = await glSnapshot();
load.lcpCandidates = await page.evaluate(() => window.__lcp ?? []);
writeFileSync(path.join(OUT, 'load.cpuprofile'), JSON.stringify(profile));

// ---- Phase 2: polling window ----
await page.evaluate(() => {
  window.__perfFrames = 0;
  const f = () => {
    window.__perfFrames++;
    requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
});
await cdp.send('Profiler.start');
await startTrace();
const f0 = await page.evaluate(() => window.__perfFrames);
const tp0 = Date.now();
await page.waitForTimeout(POLL_S * 1000);
const f1 = await page.evaluate(() => window.__perfFrames);
const pollWall = (Date.now() - tp0) / 1000;
const pollTrace = await stopTrace();
const { profile: pollProfile } = await cdp.send('Profiler.stop');
const poll = analyse(pollTrace, `polling ${POLL_S}s`);
poll.fps = +((f1 - f0) / pollWall).toFixed(1);
poll.profile = await profileTop(pollProfile, 25);
// Cumulative since navigation (deck/luma pipelines are usually created after the load window).
poll.gl = await glSnapshot();

// ---- Phase 3: memory soak ----
const mem = [];
const metric = async () => {
  const { metrics } = await cdp.send('Performance.getMetrics');
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
  return { t: Math.round((Date.now() - tNav) / 1000), heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(1), totalMB: +(m.JSHeapTotalSize / 1048576).toFixed(1), nodes: m.Nodes, listeners: m.JSEventListeners };
};
const soakEnd = Date.now() + SOAK_S * 1000;
mem.push(await metric());
while (Date.now() < soakEnd) {
  await page.waitForTimeout(15_000);
  mem.push(await metric());
}

const lazyJs = jsRequests.filter((r) => r.afterLoad);
const report = { url: URL_, at: new Date().toISOString(), loadavg: (await import('node:os')).loadavg(), counts, load, poll, mem, jsAfterLoad: lazyJs.length, jsTotal: jsRequests.length };
writeFileSync(path.join(OUT, 'trace-report.json'), JSON.stringify(report, null, 2));
await browser.close();

const p = (o) => JSON.stringify(o);
console.log(`URL ${URL_}  loadavg ${report.loadavg.map((x) => x.toFixed(1)).join(' ')}`);
console.log('entity counts (real feeds):', p(Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v.entities]))));
for (const r of [load, poll]) {
  console.log(`\n== ${r.label}: window ${r.windowMs} ms, busy ${r.busyMs} ms (cpu ${r.busyCpuMs}), idle ${r.idlePct}% (cpu-based ${r.idlePctCpu}%), long tasks ${r.longTasks} (${r.longTaskMs} ms, blocking ${r.blockingMs} ms) rAF/s ${r.rafPerSec}${r.fps != null ? ` fps ${r.fps}` : ''}`);
  console.log('groups ms:', p(r.groupsMs));
  console.log('top events:', r.topEventNames.slice(0, 12).map((x) => `${x.name}=${x.ms}`).join(' '));
  console.log('longest:', p(r.longest.slice(0, 6)));
  console.log(`profile active ${r.profile.activeMs} ms; by url:`);
  for (const u of r.profile.byUrl.slice(0, 10)) console.log(`   ${String(u.ms).padStart(6)} ms  ${u.url}`);
  console.log('top self-time functions:');
  for (const f of r.profile.top.slice(0, 20)) console.log(`   ${String(f.ms).padStart(6)} ms  ${f.fn} ${f.url.split('/').pop()}:${f.line}:${f.col}  ${f.code.slice(0, 110)}`);
  if (r.gl) {
    console.log('synchronous GL calls >= 0.5 ms (call|chunk: count, total ms, max ms):');
    for (const g of r.gl.slice(0, 16)) console.log(`   ${String(g.ms).padStart(6)} ms  n=${String(g.n).padStart(4)} max ${g.max} ms  ${g.call}`);
  }
}
console.log('\nLCP candidates:', JSON.stringify(load.lcpCandidates));
console.log('\nmemory:', mem.map((m) => `${m.t}s ${m.heapMB}MB/${m.nodes}n`).join('  '));
