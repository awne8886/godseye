/**
 * Library attribution for the initial-JS budget (tools/perf/bundle-size.mjs). Turbopack chunks have
 * no module paths in production, so modules are attributed by content: every module factory of a
 * chunk (`globalThis.TURBOPACK.push([script, id, factory, id, factory, ...])`, captured by running
 * the chunk in a `vm` sandbox that only records the push) is matched against the string literals of
 * the excluded libraries' own published sources in node_modules (maplibre-gl, @deck.gl/*, @luma.gl/*).
 *
 * Conservative by construction: a module counts as library code only when at least MIN_HITS
 * of its distinctive literals AND at least MIN_SHARE of them come from the excluded libraries; a
 * module with too few literals (small helpers, pure maths) stays counted, and a chunk that cannot be
 * split is counted whole. The budget figure can therefore only be too high, never too low.
 * Owner: map-engine.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';

/** Libraries the budget excludes (contract §10: "excluding lazy map chunks"), by pnpm store prefix. */
export const EXCLUDED_LIBRARIES = {
  'maplibre-gl': ['maplibre-gl@'],
  'deck.gl': ['@deck.gl+'],
  'luma.gl': ['@luma.gl+'],
};

export const MIN_LITERAL = 10;
export const MIN_HITS = 10;
export const MIN_SHARE = 0.4;
/** Literals too common to say anything about their origin. */
const STOPLIST = new Set(['use strict', 'use client', 'undefined', 'function', 'production', 'development', '[object Object]']);

export const gzipSize = (buf) => zlib.gzipSync(buf, { level: 9 }).length;

/**
 * Distinct string literals (>= MIN_LITERAL chars, raw text between the quotes) in a piece of
 * JavaScript, found by a left-to-right scan that skips comments and keeps quote state (a regex
 * literal holding a quote can desynchronise it locally; that only adds noise, which the share
 * threshold absorbs).
 */
export function stringLiterals(src) {
  const out = new Set();
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
    } else if (c === '/' && src[i + 1] === '/' && (i === 0 || /[\s;{}(,=]/.test(src[i - 1]))) {
      const end = src.indexOf('\n', i + 2);
      i = end < 0 ? n : end + 1;
    } else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') j++;
        else if (c !== '`' && src[j] === '\n') break;
        j++;
      }
      const s = src.slice(i + 1, j);
      if (s.length >= MIN_LITERAL && s.length <= 400 && !STOPLIST.has(s)) out.add(s);
      i = j + 1;
    } else i++;
  }
  return out;
}

function walkJs(dir, out, depth = 0) {
  if (depth > 6 || !existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.endsWith('.map') || name.endsWith('.d.ts')) continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkJs(full, out, depth + 1);
    else if (/\.(m?js|cjs)$/.test(name) && st.size < 12 * 1024 * 1024) out.push(full);
  }
}

/**
 * Literal sets per excluded library, from the published sources in the pnpm store
 * (`node_modules/.pnpm/<pkg>@<v>/node_modules/<pkg>/dist`).
 */
export function libraryLiteralSets(nodeModules, libraries = EXCLUDED_LIBRARIES) {
  const store = path.join(nodeModules, '.pnpm');
  const entries = existsSync(store) ? readdirSync(store) : [];
  const sets = {};
  for (const [lib, prefixes] of Object.entries(libraries)) {
    const set = new Set();
    for (const entry of entries.filter((e) => prefixes.some((p) => e.startsWith(p)))) {
      const pkgName = entry.startsWith('@') ? `@${entry.slice(1).split('@')[0].replace('+', '/')}` : entry.split('@')[0];
      const files = [];
      walkJs(path.join(store, entry, 'node_modules', pkgName, 'dist'), files);
      for (const f of files) for (const s of stringLiterals(readFileSync(f, 'utf8'))) set.add(s);
    }
    sets[lib] = set;
  }
  return sets;
}

/**
 * The module factories of a Turbopack chunk, in order: `[{id, source}]`. Null when the chunk is not
 * a plain module push (the runtime chunk, a chunk that throws or touches the DOM at load).
 */
export function splitTurbopackChunk(text) {
  const pushed = [];
  const sandbox = { TURBOPACK: { push: (x) => void pushed.push(x) } };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  try {
    vm.runInNewContext(text, sandbox, { timeout: 2000 });
  } catch {
    return null;
  }
  if (!pushed.length) return null;
  const modules = [];
  for (const arr of pushed) {
    if (!Array.isArray(arr)) return null;
    for (let i = 0; i < arr.length - 1; i++) {
      const id = arr[i];
      const fn = arr[i + 1];
      if ((typeof id === 'number' || typeof id === 'string') && typeof fn === 'function') {
        modules.push({ id, source: Function.prototype.toString.call(fn) });
        i++;
      }
    }
  }
  return modules.length ? modules : null;
}

/**
 * The excluded library a module's source belongs to, or null (counted). Turbopack scope-hoists
 * several packages into one module (deck.gl with luma.gl), so the threshold applies to the share of
 * literals from any excluded library; the label is the library with most hits.
 */
export function attributeModule(source, sets) {
  const lits = stringLiterals(source);
  if (lits.size < MIN_HITS) return null;
  let best = null;
  let bestHits = 0;
  let any = 0;
  const all = Object.entries(sets);
  for (const s of lits) if (all.some(([, set]) => set.has(s))) any++;
  for (const [lib, set] of all) {
    let hits = 0;
    for (const s of lits) if (set.has(s)) hits++;
    if (hits > bestHits) {
      best = lib;
      bestHits = hits;
    }
  }
  return best && any >= MIN_HITS && any / lits.size >= MIN_SHARE ? best : null;
}

/**
 * One fetched chunk: total gzip, the gzip of what remains after removing excluded-library modules
 * (the budgeted part) and the raw bytes per excluded library.
 */
export function measureChunk(url, text, sets) {
  const buf = Buffer.from(text, 'utf8');
  const total = { raw: buf.length, gzip: gzipSize(buf) };
  const modules = splitTurbopackChunk(text);
  const excluded = {};
  let kept = text;
  if (modules) {
    for (const m of modules) {
      const lib = attributeModule(m.source, sets);
      if (!lib) continue;
      const at = kept.indexOf(m.source);
      if (at < 0) continue;
      kept = kept.slice(0, at) + kept.slice(at + m.source.length);
      excluded[lib] = (excluded[lib] ?? 0) + Buffer.byteLength(m.source);
    }
  }
  const keptBuf = Buffer.from(kept, 'utf8');
  return {
    url,
    raw: total.raw,
    gzip: total.gzip,
    split: !!modules,
    modules: modules?.length ?? 0,
    countedRaw: keptBuf.length,
    countedGzip: kept === text ? total.gzip : gzipSize(keptBuf),
    excludedRaw: excluded,
  };
}

/** Budget verdict over the measured chunks. */
export function budgetReport(chunks, budgetBytes) {
  const sum = (k) => chunks.reduce((s, c) => s + c[k], 0);
  const excludedRaw = {};
  for (const c of chunks) for (const [lib, n] of Object.entries(c.excludedRaw)) excludedRaw[lib] = (excludedRaw[lib] ?? 0) + n;
  const countedGzip = sum('countedGzip');
  return {
    files: chunks.length,
    rawBytes: sum('raw'),
    gzipBytes: sum('gzip'),
    countedGzipBytes: countedGzip,
    excludedRawBytes: excludedRaw,
    unsplitFiles: chunks.filter((c) => !c.split).map((c) => c.url),
    budgetBytes,
    over: countedGzip > budgetBytes,
  };
}

/**
 * Whether a measurement can be trusted at all (verification round 6). When the basemap style never
 * loads, the map never initialises, so deck.gl/luma.gl and the default-on layers never load either
 * and the "initial JS" looks small: a false green. The run is invalid (exit 2) unless the map
 * reached `data-map-ready="true"`, every script body was read, and at least one deck.gl module was
 * attributed (the interleaved overlay is part of every default view). Returns the reasons (empty =
 * valid).
 */
export function runProblems({ mapReady, failedBodies, report }) {
  const problems = [];
  if (!mapReady) problems.push('the map never reached data-map-ready="true" (style unreachable?), so its lazy chunks were never fetched');
  if (failedBodies.length) problems.push(`${failedBodies.length} script bodies could not be read: ${failedBodies.join(', ')}`);
  if (!((report.excludedRawBytes ?? {})['deck.gl'] > 0)) problems.push('no deck.gl module was attributed: the deck overlay never loaded');
  return problems;
}
