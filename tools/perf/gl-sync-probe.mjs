#!/usr/bin/env node
/**
 * GL sync-wait probe (map-engine, perf B2). Loads a page in SwiftShader Chromium (the Lighthouse/CI
 * renderer) and records, from navigation: every synchronous WebGL call >= 5 ms (which call, when,
 * how long), draws and frames per second, long tasks, and a TBT proxy (sum of long-task time over
 * 50 ms after FCP, until WAIT_MS). Use it to see which program links / device queries block.
 *
 *   PROBE_URL=http://127.0.0.1:3157/ WAIT_MS=30000 [NOBLUR=1] node tools/perf/gl-sync-probe.mjs
 */
import { chromium } from '@playwright/test';
const url = process.env.PROBE_URL ?? 'http://127.0.0.1:3157/';
const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
  proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined,
});
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1350, height: 940 } });
const p = await ctx.newPage();
if (process.env.NOBLUR) await p.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '*,*::before,*::after{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}'; document.head.appendChild(st); }); });
await p.addInitScript(() => {
  const P = WebGL2RenderingContext.prototype;
  const st = (window.__st = { draws: 0, frames: 0, sync: 0, syncN: 0, long: [], marks: [], sec: [], firstDraw: -1, firstInstanced: -1 });
  const t0 = performance.now();
  // First draw = basemap on screen; first instanced draw = first deck entity layer (MapLibre does
  // not draw instanced; every deck primitive layer does) → time-to-first-entity proxy.
  for (const k of ['drawElements', 'drawArrays', 'drawArraysInstanced', 'drawElementsInstanced']) {
    const o = P[k];
    const inst = k.endsWith('Instanced');
    P[k] = function (...a) {
      st.draws++;
      if (st.firstDraw < 0) st.firstDraw = Math.round(performance.now());
      if (inst && st.firstInstanced < 0) st.firstInstanced = Math.round(performance.now());
      return o.apply(this, a);
    };
  }
  for (const k of ['getProgramParameter', 'getError', 'getParameter', 'getExtension', 'getUniformBlockIndex', 'getShaderParameter', 'readPixels', 'getActiveUniform', 'getUniformLocation', 'getAttribLocation', 'clientWaitSync', 'getBufferSubData']) {
    const o = P[k];
    P[k] = function (...a) { const s = performance.now(); const r = o.apply(this, a); const d = performance.now() - s; if (d > 5) { st.sync += d; st.syncN++; st.marks.push([Math.round(s - t0), k, Math.round(d)]); } return r; };
  }
  const oGC = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, o) { const s = performance.now(); const r = oGC.call(this, t, o); if (t === 'webgl2') st.marks.push([Math.round(s - t0), 'getContext', Math.round(performance.now() - s)]); return r; };
  let lastDraws = 0;
  const tick = () => { if (st.draws !== lastDraws) { st.frames++; lastDraws = st.draws; } requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  let prev = { draws: 0, frames: 0, sync: 0 };
  setInterval(() => { st.sec.push([Math.round((performance.now() - t0) / 1000), st.frames - prev.frames, st.draws - prev.draws, Math.round(st.sync - prev.sync)]); prev = { draws: st.draws, frames: st.frames, sync: st.sync }; }, 1000);
  new PerformanceObserver((l) => { for (const e of l.getEntries()) st.long.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true });
});
await p.goto(url, { waitUntil: 'load' });
await p.waitForTimeout(Number(process.env.WAIT_MS ?? 25000));
const st = await p.evaluate(() => window.__st);
const res = await p.evaluate(() => performance.getEntriesByType('resource').filter(r=>r.startTime<20000).map(r=>[r.name.replace(/^https?:\/\/[^/]+/,'').slice(0,60), Math.round(r.startTime), Math.round(r.responseEnd)]));
for (const r of res) console.log('res', JSON.stringify(r));
const fcp = await p.evaluate(() => performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0);
const tbt = st.long.filter(([s]) => s >= fcp).reduce((a, [, d]) => a + Math.max(0, d - 50), 0);
console.log('per-second [s, frames, draws, syncMs]:', JSON.stringify(st.sec));
console.log('sync >5ms marks:', JSON.stringify(st.marks));
console.log('long tasks:', JSON.stringify(st.long));
console.log(`first-draw ${st.firstDraw} ms · first-entity(instanced) ${st.firstInstanced} ms · max long task ${Math.max(0, ...st.long.map(([, d]) => d))} ms`);
console.log(`fcp ${Math.round(fcp)} TBT-proxy(0..${process.env.WAIT_MS ?? 25000}) ${tbt} frames ${st.frames} draws ${st.draws} sync ${Math.round(st.sync)} (${st.syncN})`);
await b.close();
