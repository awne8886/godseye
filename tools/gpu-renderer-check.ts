/**
 * Hardware-WebGL2 gate for Lighthouse CI on `/` (owner: pages-docs-privacy-ops).
 *
 *   CHROME_PATH=<chrome binary> pnpm lhci:gpu:check    # pre-check, before `lhci collect`
 *   CHROME_PATH=<chrome binary> pnpm lhci:gpu:verify   # after `lhci collect`: every scored run
 *   CHROME_PATH=<chrome binary> pnpm lhci:gpu          # pre-check, collect, verify, assert, upload
 *
 * The WebGL globe on `/` scores very differently when Chromium rasterises it in software, and a
 * page that fell back to "WEBGL2 REQUIRED" or "BASEMAP UNAVAILABLE" is light enough to pass every
 * contract threshold, so the thresholds only mean something when each scored run drew the globe on
 * a hardware GPU. Two layers:
 *
 * 1. Pre-check (a fast filter, so a runner without working hardware WebGL2 never spends minutes on
 *    three Lighthouse runs). It launches the CHROME_PATH binary (which LHCI reads too) with the
 *    config's `chromeFlags` through Playwright and exits 1 unless the blank-canvas WebGL2 renderer
 *    names no software rasteriser, a context refusing a major performance caveat can be created,
 *    Chromium's own WebGL status is hardware-enabled, and the MapLibre canvas of every config URL
 *    (served by the config's start command) holds a hardware WebGL2 context. This is a separate
 *    launch, not Lighthouse's: the binary and the config flags are the same, and the three
 *    Playwright defaults that change the GPU path are dropped (PLAYWRIGHT_DEFAULTS_DROPPED), but
 *    Playwright's other automation flags remain and chrome-launcher's defaults are absent (see
 *    `commandLine` in the evidence).
 * 2. Run verification (`--verify-runs`, authoritative). Every `lhr-*.json` written by `lhci collect`
 *    must carry the in-run audit `godseye-map-webgl-hardware` (tools/lighthouse/, measured in the
 *    scored page load by Lighthouse's own Chromium) with score 1 and a hardware renderer; must show
 *    the MapLibre worker and at least one basemap vector tile loaded with HTTP 200, no WebGL error
 *    in the console, the desktop settings of tools/lighthouse/gpu-config.mjs and the Chromium version
 *    the pre-check saw; the number of runs must equal numberOfRuns x URLs; the pre-check evidence
 *    must exist with ok = true; and the blank-canvas part of the pre-check is repeated, so a GPU
 *    that degraded during the runs is caught.
 *
 * Exit 2 means misconfigured (no CHROME_PATH, unreadable config, flags that select software GL or a
 * different headless mode, no in-run audit config, or LHCI settings that would launch a different
 * browser). Evidence goes to .lighthouseci/gpu-renderer.json (pre-check) and
 * .lighthouseci/gpu-runs.json (verification), which `lhci collect` leaves in place, and to the
 * GitHub Actions job summary.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { chromium, type Browser, type LaunchOptions, type Page } from '@playwright/test';

/** Renderer or vendor strings of software rasterisers (ANGLE/SwiftShader, Mesa, OSMesa, Windows WARP). */
export const SOFTWARE_RENDERER = /swiftshader|subzero|0x0000c0de|llvmpipe|softpipe|lavapipe|software|osmesa|mesa offscreen|basic render driver/i;

/** Values WebGL returns for RENDERER/VENDOR when the unmasked strings are withheld. */
export const MASKED_RENDERER = /^(webkit|webkit webgl|mozilla)$/i;

/** Flags that put WebGL on a software renderer or switch the GPU or WebGL off. */
const FORBIDDEN_FLAG = /swiftshader|osmesa|^--disable-gpu$|^--disable-webgl2?$|^--disable-3d-apis$/i;

/**
 * The three Playwright launch defaults that change the GPU path and that Lighthouse's chrome-launcher
 * does not pass, dropped from the pre-check's launch. `--enable-unsafe-swiftshader` re-enables the
 * software fallback. `--disable-field-trial-config`: on Chromium 141 (measured 2026-10-01) it made
 * Chromium hand out WebGL2 on SwiftShader when the hardware path failed, while the same flags without
 * it left WebGL2 disabled; on Chrome for Testing 153 (Playwright 1.63's build) both launches leave
 * WebGL disabled, so there it is a no-op. Playwright's own `--enable-features` would compete with the
 * config's. Playwright's other automation flags remain (see `commandLine` in the evidence).
 */
export const PLAYWRIGHT_DEFAULTS_DROPPED = ['--enable-unsafe-swiftshader', '--disable-field-trial-config', '--enable-features=CDPScreenshotNewSurface'];

/** The one MapLibre canvas (src/components/map/MapView.tsx); same selector as tools/lighthouse/map-webgl-gatherer.mjs. */
export const MAP_CANVAS = '[data-testid="map-root"] canvas.maplibregl-canvas';
/** The basemap style is fetched with retry/backoff before the map (and its canvas) exists. */
const CANVAS_TIMEOUT_MS = 90_000;
const LAUNCH_TIMEOUT_MS = 60_000;
export const EVIDENCE_FILE = '.lighthouseci/gpu-renderer.json';
export const RUNS_EVIDENCE_FILE = '.lighthouseci/gpu-runs.json';
/** The in-run audit added by tools/lighthouse/gpu-config.mjs. */
export const IN_RUN_AUDIT = 'godseye-map-webgl-hardware';
/** LHCI's default numberOfRuns. */
const LHCI_DEFAULT_RUNS = 3;

/** The module worker MapLibre starts only after it has created its WebGL context (MapView.tsx setWorkerUrl). */
export const MAPLIBRE_WORKER_PATH = /^\/maplibre\/[^/]+\/maplibre-gl-worker\.mjs$/;
/** Origin of the basemap (src/lib/map/basemap-urls.ts BASEMAP_ORIGIN; tools/ops-config.test.ts keeps them equal). */
export const BASEMAP_ORIGIN = 'https://tiles.openfreemap.org';
/** A vector tile of the basemap (`/planet/<version>/z/x/y.pbf`); glyph ranges under /fonts/ do not count. */
export const BASEMAP_VECTOR_TILE = /^https:\/\/tiles\.openfreemap\.org\/planet\/[^/]+\/\d+\/\d+\/\d+\.pbf$/;

export type Verdict = 'hardware' | 'software' | 'unknown' | 'unavailable';

export interface GlProbe {
  renderer: string | null;
  vendor: string | null;
  version: string | null;
}

/** `unavailable`: no WebGL2 context; `unknown`: no unmasked renderer string to judge. */
export function classifyRenderer(probe: GlProbe | null): Verdict {
  if (!probe) return 'unavailable';
  if ([probe.renderer, probe.vendor].some((s) => s && SOFTWARE_RENDERER.test(s))) return 'software';
  if (!probe.renderer || MASKED_RENDERER.test(probe.renderer.trim())) return 'unknown';
  return 'hardware';
}

/** LHCI accepts `chromeFlags` as one string or a list of strings. */
export function splitFlags(flags: string | readonly string[]): string[] {
  return (typeof flags === 'string' ? flags : flags.join(' ')).split(/\s+/).filter(Boolean);
}

/** Why these flags cannot measure hardware WebGL (empty when they can). */
export function flagProblems(flags: readonly string[]): string[] {
  const out = flags.filter((f) => FORBIDDEN_FLAG.test(f)).map((f) => `${f} selects software GL or disables the GPU`);
  if (!flags.includes('--headless=new')) out.push('--headless=new is required so this check and Lighthouse run the same headless mode');
  return out;
}

/** The browser's real command line must carry the config's flags and nothing that re-enables software GL. */
export function commandLineProblems(commandLine: string, flags: readonly string[]): string[] {
  const argv = commandLine.split(/\s+/);
  const out = flags.filter((f) => !argv.includes(f)).map((f) => `Chromium was not launched with ${f}`);
  for (const a of argv) {
    if (/swiftshader/i.test(a) || PLAYWRIGHT_DEFAULTS_DROPPED.includes(a)) out.push(`Chromium was launched with ${a}`);
  }
  return out;
}

/**
 * Chromium's own WebGL status (chrome://gpu feature status). Chromium up to 141 reports `webgl2`;
 * later builds (Chrome for Testing 153, which Playwright 1.63 installs) report only `webgl`.
 */
export function webglStatus(featureStatus: Readonly<Record<string, string>> | undefined): string | null {
  return featureStatus?.webgl2 ?? featureStatus?.webgl ?? null;
}

/** "enabled…" without "software", else why not. */
export function featureStatusProblem(featureStatus: Readonly<Record<string, string>> | undefined): string | null {
  const s = webglStatus(featureStatus);
  if (s && /^enabled/.test(s) && !/software/i.test(s)) return null;
  return `Chromium reports WebGL as "${s ?? 'missing'}", not hardware-enabled`;
}

export interface BrowserObservation {
  flags: readonly string[];
  commandLine: string;
  featureStatus: Readonly<Record<string, string>> | undefined;
  /** WebGL2 on a fresh canvas. */
  blank: GlProbe | null;
  /** WebGL2 on a fresh canvas with `failIfMajorPerformanceCaveat: true`. */
  refusing: GlProbe | null;
}

/** Every reason this browser cannot measure the globe on a hardware GPU (empty when it can). */
export function collectFailures(o: BrowserObservation): string[] {
  const out = commandLineProblems(o.commandLine, o.flags);
  const verdict = classifyRenderer(o.blank);
  if (verdict !== 'hardware') out.push(`blank canvas: WebGL2 renderer is ${describeProbe(o.blank, verdict)}`);
  if (o.blank && !o.refusing) out.push('blank canvas: Chromium reports a major performance caveat (failIfMajorPerformanceCaveat refused), i.e. software rendering');
  const status = featureStatusProblem(o.featureStatus);
  if (status) out.push(status);
  return out;
}

/** How the pre-check launches CHROME_PATH (exported so tests can pin it). */
export function launchOptions(chromePath: string, flags: readonly string[]): LaunchOptions {
  return {
    executablePath: chromePath,
    // The config's own --headless=new decides the mode, exactly as under Lighthouse.
    headless: false,
    args: [...flags],
    ignoreDefaultArgs: [...PLAYWRIGHT_DEFAULTS_DROPPED],
    timeout: LAUNCH_TIMEOUT_MS,
  };
}

export interface GpuCheckConfig {
  urls: string[];
  runs: number;
  flags: string[];
  /** `ci.collect.settings.configPath`, resolved against the working directory. */
  configPath: string | null;
  server: { command: string; readyPattern: string; timeoutMs: number } | null;
}

interface LhciFile {
  ci?: {
    collect?: {
      url?: string[];
      numberOfRuns?: number;
      startServerCommand?: string;
      startServerReadyPattern?: string;
      startServerReadyTimeout?: number;
      settings?: { chromeFlags?: string | string[]; configPath?: string; port?: unknown };
      [key: string]: unknown;
    };
  };
}

/** LHCI settings under which Lighthouse would run a different browser than the one this check probes. */
const OTHER_BROWSER_KEYS = ['chromePath', 'puppeteerScript', 'puppeteerLaunchOptions', 'headful'] as const;

export function readGpuConfig(file: string, cwd = process.cwd()): GpuCheckConfig {
  const collect = (JSON.parse(readFileSync(file, 'utf8')) as LhciFile).ci?.collect;
  const urls = collect?.url ?? [];
  if (urls.length === 0) throw new Error(`${file}: ci.collect.url lists no page`);
  const flags = collect?.settings?.chromeFlags;
  if (!flags) throw new Error(`${file}: ci.collect.settings.chromeFlags is missing`);
  for (const key of OTHER_BROWSER_KEYS) {
    if (collect?.[key] !== undefined) throw new Error(`${file}: ci.collect.${key} would make Lighthouse use another browser than CHROME_PATH, which this check probes`);
  }
  if (collect?.settings?.port !== undefined) throw new Error(`${file}: ci.collect.settings.port would make Lighthouse attach to an already running browser`);
  const configPath = collect?.settings?.configPath;
  return {
    urls,
    runs: collect?.numberOfRuns ?? LHCI_DEFAULT_RUNS,
    flags: splitFlags(flags),
    configPath: configPath ? path.resolve(cwd, configPath) : null,
    server: collect?.startServerCommand
      ? {
          command: collect.startServerCommand,
          // LHCI's defaults for these two settings.
          readyPattern: collect.startServerReadyPattern ?? 'listen|ready',
          timeoutMs: collect.startServerReadyTimeout ?? 10_000,
        }
      : null,
  };
}

/**
 * Runs in the page (serialised by Playwright, so self-contained): the WebGL2 context of the
 * selected canvas (MapLibre's own context when it has one) or of a fresh canvas.
 */
function readGl(arg: { selector: string | null; refuseCaveat: boolean }): GlProbe | null {
  const canvas = arg.selector ? document.querySelector(arg.selector) : document.createElement('canvas');
  if (!(canvas instanceof HTMLCanvasElement)) return null;
  const gl = canvas.getContext('webgl2', arg.refuseCaveat ? { failIfMajorPerformanceCaveat: true } : undefined);
  if (!gl) return null;
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const text = (v: unknown) => (typeof v === 'string' && v ? v : null);
  return {
    renderer: text(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)),
    vendor: text(gl.getParameter(info ? info.UNMASKED_VENDOR_WEBGL : gl.VENDOR)),
    version: text(gl.getParameter(gl.VERSION)),
  };
}

export interface RunningServer {
  stop(): Promise<void>;
  output(): string;
}

/** Starts the config's server like LHCI does (shell command, ready pattern on stdout/stderr). */
export function startServer(command: string, readyPattern: string, timeoutMs: number): Promise<RunningServer> {
  // Own process group, so stop() also ends the grandchildren (pnpm → next start) and frees the port for LHCI.
  const child = spawn('sh', ['-c', command], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const pgid = child.pid;
  let log = '';
  const ready = new RegExp(readyPattern, 'i');
  const groupAlive = () => {
    if (!pgid) return false;
    try {
      process.kill(-pgid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const stop = async () => {
    for (const [signal, waitMs] of [['SIGTERM', 10_000], ['SIGKILL', 5_000]] as const) {
      if (!groupAlive()) return;
      try {
        process.kill(-pgid!, signal);
      } catch {
        return;
      }
      const deadline = Date.now() + waitMs;
      while (groupAlive() && Date.now() < deadline) await sleep(100);
    }
  };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      void stop();
      reject(new Error(`"${command}" printed nothing matching /${readyPattern}/ within ${timeoutMs} ms:\n${log.slice(-2000)}`));
    }, timeoutMs);
    const onData = (chunk: Buffer) => {
      log = (log + chunk.toString()).slice(-20_000);
      if (ready.test(log)) {
        clearTimeout(timer);
        resolve({ stop, output: () => log });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`"${command}" exited (${code}) before it was ready:\n${log.slice(-2000)}`));
    });
  });
}

export interface PageProbe {
  url: string;
  probe: GlProbe | null;
  verdict: Verdict;
  problem: string | null;
}

/** The renderer behind the MapLibre canvas of one page. */
export async function probeMapCanvas(page: Page, url: string): Promise<PageProbe> {
  await page.goto(url, { waitUntil: 'load', timeout: CANVAS_TIMEOUT_MS });
  try {
    await page.waitForSelector(MAP_CANVAS, { state: 'attached', timeout: CANVAS_TIMEOUT_MS });
  } catch {
    const alert = await page
      .locator('[role="alert"]')
      .first()
      .textContent({ timeout: 1000 })
      .catch(() => null);
    const shown = alert?.trim() ? ` (the page shows: ${alert.trim().slice(0, 200)})` : '';
    return { url, probe: null, verdict: 'unavailable', problem: `${url}: no MapLibre canvas within ${CANVAS_TIMEOUT_MS / 1000} s${shown}` };
  }
  const probe = await page.evaluate(readGl, { selector: MAP_CANVAS, refuseCaveat: false });
  const verdict = classifyRenderer(probe);
  return { url, probe, verdict, problem: verdict === 'hardware' ? null : `${url}: MapLibre canvas renderer is ${describeProbe(probe, verdict)}` };
}

function describeProbe(probe: GlProbe | null, verdict: Verdict): string {
  if (!probe) return 'unavailable (no WebGL2 context)';
  return `${verdict}: ${probe.renderer ?? 'no renderer string'} (${probe.vendor ?? 'no vendor string'})`;
}

export interface BlankEvidence {
  probe: GlProbe | null;
  verdict: Verdict;
  refusingCaveatContext: boolean;
  webglStatus: string | null;
}

export interface Evidence {
  checkedAt: string;
  config: string;
  chromePath: string;
  chromiumVersion: string | null;
  flags: string[];
  commandLine: string | null;
  gpu: { devices: unknown[]; featureStatus: Record<string, string> } | null;
  blank: BlankEvidence | null;
  pages: PageProbe[];
  failures: string[];
  ok: boolean;
}

/** Escapes a message for a GitHub Actions workflow command (`::error::…`). */
export function workflowCommandData(s: string): string {
  return s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

const cell = (s: string | null | undefined) => (s ?? '–').replace(/\|/g, '\\|').replace(/\s+/g, ' ');

/** Markdown for the GitHub Actions job summary (pre-check). */
export function summaryMarkdown(e: Evidence): string {
  const rows = [
    ...(e.blank ? [`| blank canvas | ${cell(e.blank.probe?.renderer)} | ${cell(e.blank.probe?.vendor)} | ${e.blank.verdict} |`] : []),
    ...e.pages.map((p) => `| ${cell(p.url)} (MapLibre canvas) | ${cell(p.probe?.renderer)} | ${cell(p.probe?.vendor)} | ${p.verdict} |`),
  ];
  return [
    `### Lighthouse on \`/\`, pre-check (separate launch of the same Chromium and chromeFlags): ${e.ok ? 'hardware GPU' : 'NOT a hardware GPU'}`,
    '',
    '| Where | Unmasked WebGL2 renderer | Vendor | Verdict |',
    '|---|---|---|---|',
    ...rows,
    '',
    `Chromium ${cell(e.chromiumVersion)} at \`${e.chromePath}\`, flags \`${e.flags.join(' ')}\`, checked ${e.checkedAt}.`,
    ...(e.failures.length ? ['', ...e.failures.map((f) => `- ${cell(f)}`)] : []),
    '',
  ].join('\n');
}

/* ------------------------------------------------------------------------------------------------
 * Verification of the scored runs (`--verify-runs`)
 * ---------------------------------------------------------------------------------------------- */

interface LhrAudit {
  score?: number | null;
  displayValue?: string;
  numericValue?: number;
  details?: { type?: string; items?: unknown[]; [key: string]: unknown };
}

/** The parts of a Lighthouse result this check reads. */
export interface LhrLike {
  requestedUrl?: string;
  finalDisplayedUrl?: string;
  runtimeError?: { code?: string; message?: string };
  configSettings?: { formFactor?: string; screenEmulation?: unknown; throttling?: unknown; emulatedUserAgent?: unknown };
  audits?: Record<string, LhrAudit | undefined>;
  categories?: Record<string, { score?: number | null } | undefined>;
}

/** What every run must have been measured with: the config module's desktop settings and the pre-checked Chromium. */
export interface RunExpectations {
  settings: { formFactor?: unknown; screenEmulation?: unknown; throttling?: unknown; emulatedUserAgent?: unknown };
  chromiumVersion: string | null;
}

export interface RunReport {
  file: string;
  url: string | null;
  /** displayValue of the in-run audit: the renderer that drew the globe in this run. */
  renderer: string | null;
  auditScore: number | null;
  performance: number | null;
  accessibility: number | null;
  lcpMs: number | null;
  tbtMs: number | null;
  cls: number | null;
  worker: boolean;
  vectorTiles: number;
  problems: string[];
}

/** `details` of the in-run audit (tools/lighthouse/map-webgl-gatherer.mjs artifact plus `type`). */
interface InRunDetails {
  canvas?: boolean;
  context?: boolean;
  renderer?: string | null;
  vendor?: string | null;
  version?: string | null;
  hardwareContext?: boolean;
  product?: string;
  gpu?: { featureStatus?: Record<string, string> | null; devices?: unknown[]; error?: string | null };
}

interface NetworkItem {
  url?: unknown;
  statusCode?: unknown;
}
interface ConsoleItem {
  description?: unknown;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** One run: was the globe drawn on a hardware GPU with its worker and basemap, under the expected settings? */
export function inspectRun(file: string, lhr: LhrLike, expected: RunExpectations): RunReport {
  const problems: string[] = [];
  const audits = lhr.audits ?? {};
  const url = lhr.requestedUrl ?? null;
  if (lhr.runtimeError) problems.push(`Lighthouse runtime error ${lhr.runtimeError.code ?? ''}: ${lhr.runtimeError.message ?? ''}`.trim());

  // Same desktop settings as the config module (Lighthouse ignores `preset` once a config path is set).
  const cs = lhr.configSettings ?? {};
  for (const key of ['formFactor', 'screenEmulation', 'throttling', 'emulatedUserAgent'] as const) {
    if (!isDeepStrictEqual(cs[key], expected.settings[key])) problems.push(`configSettings.${key} differs from tools/lighthouse/gpu-config.mjs (${JSON.stringify(cs[key]) ?? 'missing'})`);
  }
  if (url && lhr.finalDisplayedUrl) {
    const a = new URL(url);
    const b = new URL(lhr.finalDisplayedUrl);
    if (a.origin !== b.origin || a.pathname !== b.pathname) problems.push(`the page ended at ${lhr.finalDisplayedUrl}, not ${url}`);
  }

  // The in-run audit: the renderer of the MapLibre canvas in this very page load, and the measuring
  // browser's own report. Re-judged here with this file's rules, so the two implementations must agree.
  const audit = audits[IN_RUN_AUDIT];
  const d = (audit?.details ?? {}) as InRunDetails;
  const probe: GlProbe | null = d.context === true ? { renderer: d.renderer ?? null, vendor: d.vendor ?? null, version: d.version ?? null } : null;
  if (!audit) problems.push(`audit ${IN_RUN_AUDIT} is missing (is ci.collect.settings.configPath tools/lighthouse/gpu-config.mjs?)`);
  else if (audit.score !== 1) problems.push(`globe not drawn on a hardware GPU in this run: ${audit.displayValue ?? 'no result'}`);
  else {
    const verdict = classifyRenderer(probe);
    if (verdict !== 'hardware' || d.hardwareContext !== true) problems.push(`audit ${IN_RUN_AUDIT} passed but its renderer is ${describeProbe(probe, verdict)}`);
    const status = featureStatusProblem(d.gpu?.featureStatus ?? undefined);
    if (status) problems.push(`audit ${IN_RUN_AUDIT} passed but ${status}`);
  }
  // The browser Lighthouse launched is the binary the pre-check probed (full version from
  // Browser.getVersion; the report's user agent is reduced to "<major>.0.0.0").
  const product = d.product ?? '';
  if (!expected.chromiumVersion || !product.endsWith(`/${expected.chromiumVersion}`)) {
    problems.push(`Lighthouse ran "${product || 'an unknown browser'}", not the pre-checked Chromium ${expected.chromiumVersion ?? '(no pre-check version)'}`);
  }

  // The worker (created after MapLibre's WebGL context) and the basemap's vector tiles actually loaded.
  const items = (audits['network-requests']?.details?.items ?? []) as NetworkItem[];
  const ok200 = (i: NetworkItem) => i.statusCode === 200 && typeof i.url === 'string';
  const origin = url ? new URL(url).origin : null;
  const worker = items.some((i) => {
    if (!ok200(i) || !URL.canParse(i.url as string)) return false;
    const u = new URL(i.url as string);
    return u.origin === origin && MAPLIBRE_WORKER_PATH.test(u.pathname);
  });
  const vectorTiles = items.filter((i) => ok200(i) && BASEMAP_VECTOR_TILE.test(i.url as string)).length;
  if (!worker) problems.push('the MapLibre worker (/maplibre/<version>/maplibre-gl-worker.mjs) was not loaded with HTTP 200');
  if (vectorTiles === 0) problems.push(`no basemap vector tile (${BASEMAP_ORIGIN}/planet/…/z/x/y.pbf) was loaded with HTTP 200`);

  const consoleItems = (audits['errors-in-console']?.details?.items ?? []) as ConsoleItem[];
  for (const c of consoleItems) {
    if (typeof c.description === 'string' && /webgl/i.test(c.description)) problems.push(`console error mentions WebGL: ${c.description.slice(0, 200)}`);
  }

  return {
    file,
    url,
    renderer: audit?.displayValue ?? null,
    auditScore: num(audit?.score),
    performance: num(lhr.categories?.performance?.score),
    accessibility: num(lhr.categories?.accessibility?.score),
    lcpMs: num(audits['largest-contentful-paint']?.numericValue),
    tbtMs: num(audits['total-blocking-time']?.numericValue),
    cls: num(audits['cumulative-layout-shift']?.numericValue),
    worker,
    vectorTiles,
    problems,
  };
}

/** All runs: the right number per URL, each one passing inspectRun. */
export function verifyRuns(lhrs: ReadonlyArray<{ file: string; lhr: LhrLike }>, config: Pick<GpuCheckConfig, 'urls' | 'runs'>, expected: RunExpectations): { runs: RunReport[]; failures: string[] } {
  const runs = lhrs.map(({ file, lhr }) => inspectRun(file, lhr, expected));
  const failures: string[] = [];
  const total = config.runs * config.urls.length;
  if (lhrs.length !== total) failures.push(`expected ${total} Lighthouse runs (${config.runs} x ${config.urls.length} URL), found ${lhrs.length} lhr-*.json`);
  for (const u of config.urls) {
    const n = runs.filter((r) => r.url === u).length;
    if (n !== config.runs) failures.push(`${u}: ${n} runs, expected ${config.runs}`);
  }
  for (const r of runs) {
    if (r.url && !config.urls.includes(r.url)) failures.push(`${r.file}: ${r.url} is not a URL of the config`);
    for (const p of r.problems) failures.push(`${r.file} (${r.url ?? 'no URL'}): ${p}`);
  }
  return { runs, failures };
}

export interface RunsEvidence {
  checkedAt: string;
  config: string;
  chromePath: string;
  chromiumVersion: string | null;
  expectedRuns: number;
  runs: RunReport[];
  /** The blank-canvas pre-check repeated after the runs. */
  blankAfter: BlankEvidence | null;
  failures: string[];
  ok: boolean;
}

const fixed = (v: number | null, digits: number) => (v === null ? '–' : v.toFixed(digits));

/** Markdown for the GitHub Actions job summary (verification): the renderer each scored run was drawn on. */
export function runsSummaryMarkdown(e: RunsEvidence): string {
  return [
    `### Lighthouse on \`/\`, scored runs: ${e.ok ? 'every run drew the globe on a hardware GPU' : 'NOT verified on a hardware GPU'}`,
    '',
    `| Run | URL | Renderer that drew the globe (in-run audit \`${IN_RUN_AUDIT}\`) | Perf | A11y | LCP ms | TBT ms | CLS | Worker | Vector tiles |`,
    '|---|---|---|---|---|---|---|---|---|---|',
    ...e.runs.map(
      (r) =>
        `| ${cell(r.file)} | ${cell(r.url)} | ${cell(r.renderer)} | ${fixed(r.performance, 2)} | ${fixed(r.accessibility, 2)} | ${fixed(r.lcpMs, 0)} | ${fixed(r.tbtMs, 0)} | ${fixed(r.cls, 3)} | ${r.worker ? 'yes' : 'no'} | ${r.vectorTiles} |`,
    ),
    '',
    `After the runs, blank canvas: ${cell(e.blankAfter ? describeProbe(e.blankAfter.probe, e.blankAfter.verdict) : 'not probed')}. Chromium ${cell(e.chromiumVersion)} at \`${e.chromePath}\`, verified ${e.checkedAt}. The scores are asserted by \`lhci assert\` in the next step.`,
    ...(e.failures.length ? ['', ...e.failures.map((f) => `- ${cell(f)}`)] : []),
    '',
  ].join('\n');
}

/* ------------------------------------------------------------------------------------------------
 * Browser and CLI
 * ---------------------------------------------------------------------------------------------- */

/** What one launched browser reports about itself. */
export interface BrowserReport extends BrowserObservation {
  version: string;
  gpu: { devices: unknown[]; featureStatus: Record<string, string> };
}

async function observeBrowser(browser: Browser, flags: readonly string[]): Promise<BrowserReport> {
  const cdp = await browser.newBrowserCDPSession();
  const info = await cdp.send('SystemInfo.getInfo');
  const page = await browser.newPage();
  try {
    const blank = await page.evaluate(readGl, { selector: null, refuseCaveat: false });
    const refusing = await page.evaluate(readGl, { selector: null, refuseCaveat: true });
    const featureStatus = info.gpu.featureStatus ?? {};
    return { version: browser.version(), flags, commandLine: info.commandLine, featureStatus, blank, refusing, gpu: { devices: info.gpu.devices, featureStatus } };
  } finally {
    await page.close();
  }
}

const blankEvidence = (o: BrowserObservation): BlankEvidence => ({
  probe: o.blank,
  verdict: classifyRenderer(o.blank),
  refusingCaveatContext: o.refusing !== null,
  webglStatus: webglStatus(o.featureStatus),
});

async function precheck(browser: Browser, config: GpuCheckConfig, e: Evidence): Promise<void> {
  const o = await observeBrowser(browser, config.flags);
  e.chromiumVersion = o.version;
  e.commandLine = o.commandLine;
  e.gpu = o.gpu;
  e.blank = blankEvidence(o);
  e.failures.push(...collectFailures(o));
  // Starting the app is pointless (and slow) once the browser itself has no hardware WebGL2.
  if (e.failures.length) return;

  const server = config.server ? await startServer(config.server.command, config.server.readyPattern, config.server.timeoutMs) : null;
  const page = await browser.newPage();
  try {
    for (const url of config.urls) {
      const result = await probeMapCanvas(page, url);
      e.pages.push(result);
      if (result.problem) e.failures.push(result.problem);
    }
  } finally {
    await page.close();
    await server?.stop();
  }
}

/** Launches CHROME_PATH with the config flags and reads the blank-canvas state (the default `observe`). */
export function launchAndObserve(chromePath: string, flags: readonly string[]): Promise<BrowserReport> {
  return withBrowser(chromePath, flags, (b) => observeBrowser(b, flags));
}

export interface MainOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  log?: (line: string) => void;
  /** How `--verify-runs` re-observes the browser after the runs (tests pass recorded reports). */
  observe?: (chromePath: string, flags: readonly string[]) => Promise<BrowserReport>;
}

type Ctx = {
  env: NodeJS.ProcessEnv;
  cwd: string;
  log: (line: string) => void;
  observe: (chromePath: string, flags: readonly string[]) => Promise<BrowserReport>;
  configFile: string;
  config: GpuCheckConfig;
  chromePath: string;
};

const errorLine = (title: string, msg: string) => `::error title=${title}::${workflowCommandData(msg)}`;

function writeJson(cwd: string, rel: string, value: unknown): void {
  const file = path.join(cwd, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function withBrowser<T>(chromePath: string, flags: readonly string[], fn: (b: Browser) => Promise<T>): Promise<T> {
  const browser = await chromium.launch(launchOptions(chromePath, flags));
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

async function runPrecheck(ctx: Ctx): Promise<number> {
  const evidence: Evidence = {
    checkedAt: new Date().toISOString(),
    config: path.relative(ctx.cwd, ctx.configFile),
    chromePath: ctx.chromePath,
    chromiumVersion: null,
    flags: ctx.config.flags,
    commandLine: null,
    gpu: null,
    blank: null,
    pages: [],
    failures: [],
    ok: false,
  };
  try {
    await withBrowser(ctx.chromePath, ctx.config.flags, (b) => precheck(b, ctx.config, evidence));
  } catch (err) {
    evidence.failures.push(`check aborted: ${(err as Error).message.split('\n')[0]}`);
  }
  evidence.ok = evidence.failures.length === 0;
  writeJson(ctx.cwd, EVIDENCE_FILE, evidence);
  if (ctx.env.GITHUB_STEP_SUMMARY) appendFileSync(ctx.env.GITHUB_STEP_SUMMARY, summaryMarkdown(evidence));
  const blank = evidence.blank;
  ctx.log(`Pre-check, WebGL2 renderer for Lighthouse on /: ${blank ? describeProbe(blank.probe, blank.verdict) : 'not probed'}; Chromium ${evidence.chromiumVersion ?? 'not started'}; evidence in ${EVIDENCE_FILE}`);
  for (const p of evidence.pages) ctx.log(`  ${p.url} MapLibre canvas: ${describeProbe(p.probe, p.verdict)}`);
  for (const f of evidence.failures) ctx.log(errorLine('Lighthouse on / not measured on a hardware GPU', f));
  return evidence.ok ? 0 : 1;
}

/** The pre-check's evidence, which must exist with ok = true for the same binary. */
function readPrecheck(ctx: Ctx): { problem: string | null; chromiumVersion: string | null } {
  let e: Partial<Evidence>;
  try {
    e = JSON.parse(readFileSync(path.join(ctx.cwd, EVIDENCE_FILE), 'utf8')) as Partial<Evidence>;
  } catch {
    return { problem: `${EVIDENCE_FILE} is missing or unreadable: run the pre-check (pnpm lhci:gpu:check) before collecting`, chromiumVersion: null };
  }
  const chromiumVersion = typeof e.chromiumVersion === 'string' ? e.chromiumVersion : null;
  if (e.ok !== true) return { problem: `${EVIDENCE_FILE} records a failed pre-check`, chromiumVersion };
  if (e.chromePath !== ctx.chromePath) return { problem: `${EVIDENCE_FILE} checked ${String(e.chromePath)}, not CHROME_PATH ${ctx.chromePath}`, chromiumVersion };
  return { problem: null, chromiumVersion };
}

async function runVerify(ctx: Ctx): Promise<number> {
  const evidence: RunsEvidence = {
    checkedAt: new Date().toISOString(),
    config: path.relative(ctx.cwd, ctx.configFile),
    chromePath: ctx.chromePath,
    chromiumVersion: null,
    expectedRuns: ctx.config.runs * ctx.config.urls.length,
    runs: [],
    blankAfter: null,
    failures: [],
    ok: false,
  };
  try {
    const pre = readPrecheck(ctx);
    evidence.chromiumVersion = pre.chromiumVersion;
    if (pre.problem) evidence.failures.push(pre.problem);

    const mod = (await import(pathToFileURL(ctx.config.configPath!).href)) as { default?: { settings?: RunExpectations['settings'] } };
    const settings = mod.default?.settings;
    if (!settings) throw new Error(`${ctx.config.configPath} exports no settings`);

    const dir = path.join(ctx.cwd, '.lighthouseci');
    const files = existsSync(dir) ? readdirSync(dir).filter((f) => /^lhr-\d+\.json$/.test(f)).sort() : [];
    const lhrs = files.map((file) => ({ file, lhr: JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as LhrLike }));
    const result = verifyRuns(lhrs, ctx.config, { settings, chromiumVersion: pre.chromiumVersion });
    evidence.runs = result.runs;
    evidence.failures.push(...result.failures);

    // The GPU must still be there after the runs (a GPU-process crash or a lost device shows up here).
    const after = await ctx.observe(ctx.chromePath, ctx.config.flags);
    evidence.blankAfter = blankEvidence(after);
    evidence.failures.push(...collectFailures(after).map((f) => `after the runs: ${f}`));
  } catch (err) {
    evidence.failures.push(`verification aborted: ${(err as Error).message.split('\n')[0]}`);
  }
  evidence.ok = evidence.failures.length === 0;
  writeJson(ctx.cwd, RUNS_EVIDENCE_FILE, evidence);
  if (ctx.env.GITHUB_STEP_SUMMARY) appendFileSync(ctx.env.GITHUB_STEP_SUMMARY, runsSummaryMarkdown(evidence));
  for (const r of evidence.runs) ctx.log(`  ${r.file} ${r.url ?? ''}: ${r.renderer ?? 'no in-run renderer'} (worker ${r.worker ? 'loaded' : 'missing'}, ${r.vectorTiles} vector tiles)`);
  ctx.log(`Verified ${evidence.runs.length}/${evidence.expectedRuns} Lighthouse runs on /: ${evidence.ok ? 'every run drew the globe on a hardware GPU' : 'NOT verified'}; evidence in ${RUNS_EVIDENCE_FILE}`);
  for (const f of evidence.failures) ctx.log(errorLine('Lighthouse on / not measured on a hardware GPU', f));
  return evidence.ok ? 0 : 1;
}

/** `[--verify-runs] [lighthouserc.gpu.json]`; exit 0 pass, 1 fail, 2 misconfigured. */
export async function main(argv: readonly string[], opts: MainOptions = {}): Promise<number> {
  const env = opts.env ?? process.env;
  const cwd = opts.cwd ?? process.cwd();
  const log = opts.log ?? ((line: string) => console.log(line));
  const misconfigured = (msg: string) => {
    log(errorLine('GPU check misconfigured', msg));
    return 2;
  };
  const unknown = argv.filter((a) => a.startsWith('--') && a !== '--verify-runs');
  if (unknown.length) return misconfigured(`unknown option ${unknown.join(' ')} (usage: [--verify-runs] [lighthouserc.gpu.json])`);
  const configFile = path.resolve(cwd, argv.find((a) => !a.startsWith('--')) ?? 'lighthouserc.gpu.json');
  let config: GpuCheckConfig;
  try {
    config = readGpuConfig(configFile, cwd);
  } catch (err) {
    return misconfigured((err as Error).message);
  }
  const issues = flagProblems(config.flags);
  if (!config.configPath || !existsSync(config.configPath)) {
    issues.push('ci.collect.settings.configPath must name tools/lighthouse/gpu-config.mjs, so every scored run carries the in-run hardware audit');
  }
  const chromePath = env.CHROME_PATH ?? '';
  if (!chromePath || !existsSync(chromePath)) issues.push(`CHROME_PATH must name the Chromium binary Lighthouse CI uses (got "${chromePath}")`);
  if (issues.length) {
    for (const issue of issues) log(errorLine('GPU check misconfigured', `${path.basename(configFile)}: ${issue}`));
    return 2;
  }
  const ctx: Ctx = { env, cwd, log, observe: opts.observe ?? launchAndObserve, configFile, config, chromePath };
  return argv.includes('--verify-runs') ? runVerify(ctx) : runPrecheck(ctx);
}

/**
 * True when Node runs this file as the entry point. Node loads the entry by its real path, so
 * argv[1] is compared after resolving symlinks (a plain path comparison silently skipped main(),
 * exit 0, when the script was reached through a symlink).
 */
function invokedAsScript(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (invokedAsScript()) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(err);
      process.exit(1);
    },
  );
}
