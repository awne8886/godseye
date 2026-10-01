/**
 * Hardware-WebGL2 gate for Lighthouse CI on `/` (owner: pages-docs-privacy-ops).
 *
 *   CHROME_PATH=<chrome binary> pnpm lhci:gpu:check          # checks lighthouserc.gpu.json
 *   CHROME_PATH=<chrome binary> pnpm lhci:gpu                # check, then Lighthouse CI on `/`
 *
 * The WebGL globe on `/` scores very differently when Chromium rasterises it in software, so the
 * contract thresholds are only meaningful on a hardware GPU. This check launches the binary that
 * Lighthouse CI will use (`CHROME_PATH`, which LHCI reads too) with the config's exact
 * `chromeFlags`, and exits 1 unless:
 *   - Chromium's own command line carries those flags and none of the Playwright defaults that
 *     Lighthouse's chrome-launcher does not pass (see PLAYWRIGHT_DEFAULTS_DROPPED);
 *   - on a blank canvas, WebGL2 exists, its unmasked renderer and vendor name no software
 *     rasteriser, Chromium reports WebGL2 as enabled without "software", and a context that
 *     refuses a major performance caveat (`failIfMajorPerformanceCaveat`) can be created;
 *   - on every URL of the config, served by the config's own start command, the MapLibre canvas
 *     holds a WebGL2 context whose renderer passes the same test.
 * Exit 2 means misconfigured (no CHROME_PATH, unreadable config, or flags that select software GL
 * or a different headless mode). Evidence (renderer strings, GPU devices, feature status, command
 * line, Chromium version) is written to .lighthouseci/gpu-renderer.json, which LHCI leaves in
 * place, and to the GitHub Actions job summary.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type Page } from '@playwright/test';

/** Renderer or vendor strings of software rasterisers (ANGLE/SwiftShader, Mesa, OSMesa, Windows WARP). */
export const SOFTWARE_RENDERER = /swiftshader|subzero|0x0000c0de|llvmpipe|softpipe|lavapipe|software|osmesa|mesa offscreen|basic render driver/i;

/** Values WebGL returns for RENDERER/VENDOR when the unmasked strings are withheld. */
const MASKED = /^(webkit|webkit webgl|mozilla)$/i;

/** Flags that put WebGL on a software renderer or switch the GPU or WebGL off. */
const FORBIDDEN_FLAG = /swiftshader|osmesa|^--disable-gpu$|^--disable-webgl2?$|^--disable-3d-apis$/i;

/**
 * Playwright launch defaults that Lighthouse's chrome-launcher does not pass and that change the GPU
 * path, so the check drops them to launch Chromium the way Lighthouse does:
 * `--enable-unsafe-swiftshader` re-enables the software fallback; with `--disable-field-trial-config`
 * Chromium 141 still handed out WebGL2 on SwiftShader when the hardware path failed (measured
 * 2026-10-01), while the same flags without it left WebGL2 disabled; and Playwright's own
 * `--enable-features` switch would compete with the config's.
 */
export const PLAYWRIGHT_DEFAULTS_DROPPED = ['--enable-unsafe-swiftshader', '--disable-field-trial-config', '--enable-features=CDPScreenshotNewSurface'];

/** The one MapLibre canvas (src/components/map/MapView.tsx). */
export const MAP_CANVAS = '[data-testid="map-root"] canvas.maplibregl-canvas';
/** The basemap style is fetched with retry/backoff before the map (and its canvas) exists. */
const CANVAS_TIMEOUT_MS = 90_000;
const LAUNCH_TIMEOUT_MS = 60_000;
export const EVIDENCE_FILE = '.lighthouseci/gpu-renderer.json';

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
  if (!probe.renderer || MASKED.test(probe.renderer.trim())) return 'unknown';
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

/** Chromium's own WebGL2 status (chrome://gpu): "enabled…" without "software". */
export function featureStatusProblem(webgl2: string | undefined): string | null {
  if (webgl2 && /^enabled/.test(webgl2) && !/software/i.test(webgl2)) return null;
  return `Chromium reports WebGL2 as "${webgl2 ?? 'missing'}", not hardware-enabled`;
}

export interface GpuCheckConfig {
  urls: string[];
  flags: string[];
  server: { command: string; readyPattern: string; timeoutMs: number } | null;
}

interface LhciFile {
  ci?: {
    collect?: {
      url?: string[];
      startServerCommand?: string;
      startServerReadyPattern?: string;
      startServerReadyTimeout?: number;
      settings?: { chromeFlags?: string | string[] };
    };
  };
}

export function readGpuConfig(file: string): GpuCheckConfig {
  const collect = (JSON.parse(readFileSync(file, 'utf8')) as LhciFile).ci?.collect;
  const urls = collect?.url ?? [];
  if (urls.length === 0) throw new Error(`${file}: ci.collect.url lists no page`);
  const flags = collect?.settings?.chromeFlags;
  if (!flags) throw new Error(`${file}: ci.collect.settings.chromeFlags is missing`);
  return {
    urls,
    flags: splitFlags(flags),
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
  return { url, probe, verdict, problem: verdict === 'hardware' ? null : `${url}: MapLibre canvas renderer is ${describe(probe, verdict)}` };
}

function describe(probe: GlProbe | null, verdict: Verdict): string {
  if (!probe) return 'unavailable (no WebGL2 context)';
  return `${verdict}: ${probe.renderer ?? 'no renderer string'} (${probe.vendor ?? 'no vendor string'})`;
}

export interface Evidence {
  checkedAt: string;
  config: string;
  chromePath: string;
  chromiumVersion: string | null;
  flags: string[];
  commandLine: string | null;
  gpu: { devices: unknown[]; featureStatus: Record<string, string> } | null;
  blank: { probe: GlProbe | null; verdict: Verdict; refusingCaveatContext: boolean; webgl2Status: string | null } | null;
  pages: PageProbe[];
  failures: string[];
  ok: boolean;
}

/** Escapes a message for a GitHub Actions workflow command (`::error::…`). */
export function workflowCommandData(s: string): string {
  return s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

const cell = (s: string | null | undefined) => (s ?? '–').replace(/\|/g, '\\|').replace(/\s+/g, ' ');

/** Markdown for the GitHub Actions job summary. */
export function summaryMarkdown(e: Evidence): string {
  const rows = [
    ...(e.blank ? [`| blank canvas | ${cell(e.blank.probe?.renderer)} | ${cell(e.blank.probe?.vendor)} | ${e.blank.verdict} |`] : []),
    ...e.pages.map((p) => `| ${cell(p.url)} (MapLibre canvas) | ${cell(p.probe?.renderer)} | ${cell(p.probe?.vendor)} | ${p.verdict} |`),
  ];
  return [
    `### Lighthouse on \`/\`: WebGL2 renderer check: ${e.ok ? 'hardware GPU' : 'NOT measured on a hardware GPU'}`,
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

async function inspect(browser: Browser, config: GpuCheckConfig, e: Evidence): Promise<void> {
  e.chromiumVersion = browser.version();
  const cdp = await browser.newBrowserCDPSession();
  const info = await cdp.send('SystemInfo.getInfo');
  e.commandLine = info.commandLine;
  e.gpu = { devices: info.gpu.devices, featureStatus: info.gpu.featureStatus ?? {} };
  e.failures.push(...commandLineProblems(info.commandLine, config.flags));

  const page = await browser.newPage();
  const probe = await page.evaluate(readGl, { selector: null, refuseCaveat: false });
  const refusing = await page.evaluate(readGl, { selector: null, refuseCaveat: true });
  const webgl2Status = info.gpu.featureStatus?.webgl2 ?? null;
  const verdict = classifyRenderer(probe);
  e.blank = { probe, verdict, refusingCaveatContext: refusing !== null, webgl2Status };
  if (verdict !== 'hardware') e.failures.push(`blank canvas: WebGL2 renderer is ${describe(probe, verdict)}`);
  if (probe && !refusing) e.failures.push('blank canvas: Chromium reports a major performance caveat (failIfMajorPerformanceCaveat refused), i.e. software rendering');
  const status = featureStatusProblem(webgl2Status ?? undefined);
  if (status) e.failures.push(status);
  // Starting the app is pointless (and slow) once the browser itself has no hardware WebGL2.
  if (e.failures.length) return;

  const server = config.server ? await startServer(config.server.command, config.server.readyPattern, config.server.timeoutMs) : null;
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

export async function main(argv: readonly string[]): Promise<number> {
  const configFile = path.resolve(argv[0] ?? 'lighthouserc.gpu.json');
  const fail = (title: string, msg: string) => console.log(`::error title=${title}::${workflowCommandData(msg)}`);
  let config: GpuCheckConfig;
  try {
    config = readGpuConfig(configFile);
  } catch (err) {
    fail('GPU check misconfigured', (err as Error).message);
    return 2;
  }
  const flagIssues = flagProblems(config.flags);
  const chromePath = process.env.CHROME_PATH ?? '';
  if (!chromePath || !existsSync(chromePath)) flagIssues.push(`CHROME_PATH must name the Chromium binary Lighthouse CI uses (got "${chromePath}")`);
  if (flagIssues.length) {
    for (const issue of flagIssues) fail('GPU check misconfigured', `${path.basename(configFile)}: ${issue}`);
    return 2;
  }

  const evidence: Evidence = {
    checkedAt: new Date().toISOString(),
    config: path.relative(process.cwd(), configFile),
    chromePath,
    chromiumVersion: null,
    flags: config.flags,
    commandLine: null,
    gpu: null,
    blank: null,
    pages: [],
    failures: [],
    ok: false,
  };
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({
      executablePath: chromePath,
      // The config's own --headless=new decides the mode, exactly as under Lighthouse.
      headless: false,
      args: config.flags,
      ignoreDefaultArgs: PLAYWRIGHT_DEFAULTS_DROPPED,
      timeout: LAUNCH_TIMEOUT_MS,
    });
    await inspect(browser, config, evidence);
  } catch (err) {
    evidence.failures.push(`check aborted: ${(err as Error).message.split('\n')[0]}`);
  } finally {
    await browser?.close();
  }
  evidence.ok = evidence.failures.length === 0;

  mkdirSync(path.dirname(EVIDENCE_FILE), { recursive: true });
  writeFileSync(EVIDENCE_FILE, `${JSON.stringify(evidence, null, 2)}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryMarkdown(evidence));
  const blank = evidence.blank;
  console.log(
    `WebGL2 renderer for Lighthouse on /: ${blank ? describe(blank.probe, blank.verdict) : 'not probed'}; Chromium ${evidence.chromiumVersion ?? 'not started'}; evidence in ${EVIDENCE_FILE}`,
  );
  for (const p of evidence.pages) console.log(`  ${p.url} MapLibre canvas: ${describe(p.probe, p.verdict)}`);
  for (const f of evidence.failures) fail('Lighthouse on / not measured on a hardware GPU', f);
  return evidence.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(err);
      process.exit(1);
    },
  );
}
