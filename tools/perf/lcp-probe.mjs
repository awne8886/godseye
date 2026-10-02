#!/usr/bin/env node
/**
 * LCP probe (perf-auditor). Explains a render-delay-bound LCP: records every LCP candidate
 * (time, size, element), console errors (hydration mismatches), and whether the server-rendered
 * nodes survived hydration (a node replaced by a client re-render is painted again, later).
 *
 *   node tools/perf/lcp-probe.mjs [--url http://127.0.0.1:3000/] [--wait-s 15] [--selector 'css']
 */
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const URL_ = opt('--url', 'http://127.0.0.1:3000/');
const WAIT_S = Number(opt('--wait-s', '15'));
const SELECTOR = opt('--selector', 'main > div.hud-micro > span');
const PROXY = process.env.HTTPS_PROXY ?? '';

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? '/opt/pw-browsers/chromium',
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
  proxy: PROXY ? { server: PROXY, bypass: 'localhost,127.0.0.1' } : undefined,
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1350, height: 940 } });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text().slice(0, 240)}`);
});
page.on('pageerror', (e) => logs.push(`pageerror: ${String(e.message).slice(0, 240)}`));
await page.addInitScript((sel) => {
  window.__lcp = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      const el = e.element;
      window.__lcp.push({ t: Math.round(e.startTime), render: Math.round(e.renderTime), size: e.size, tag: el?.tagName ?? null, text: (el?.textContent ?? '').slice(0, 50), connectedNow: el ? el.isConnected : null });
    }
  }).observe({ type: 'largest-contentful-paint', buffered: true });
  window.__paint = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) window.__paint.push({ name: e.name, t: Math.round(e.startTime) });
  }).observe({ type: 'paint', buffered: true });
  document.addEventListener('DOMContentLoaded', () => {
    window.__ssrNodes = [...document.querySelectorAll(sel)];
    window.__ssrMain = document.querySelector('main');
    window.__dcl = Math.round(performance.now());
  });
}, SELECTOR);
await page.goto(URL_, { waitUntil: 'load', timeout: 120_000 });
await page.waitForTimeout(WAIT_S * 1000);
const out = await page.evaluate(() => ({
  dcl: window.__dcl,
  paint: window.__paint,
  lcp: window.__lcp.map((e) => ({ ...e })),
  ssrNodes: (window.__ssrNodes ?? []).length,
  ssrNodesStillConnected: (window.__ssrNodes ?? []).filter((n) => n.isConnected).length,
  ssrMainStillConnected: window.__ssrMain ? window.__ssrMain.isConnected : null,
}));
console.log(JSON.stringify(out, null, 1));
console.log(`console errors/warnings (${logs.length}):`);
for (const l of logs.slice(0, 20)) console.log('  ', l);
await browser.close();
