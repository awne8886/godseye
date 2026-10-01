/**
 * Guards for the operations files owned by pages-docs-privacy-ops: the CI workflow and compose file
 * parse as YAML and keep their gates; the Dockerfile builds with `pnpm build`, runs as non-root and
 * bakes in no secrets; Caddy overwrites X-Forwarded-For; Lighthouse CI keeps the contract thresholds,
 * with `/` measured only on a GPU runner and every scored run verified to have drawn the globe on a
 * hardware GPU; the README documents every optional variable and capability and the GPU runner set-up.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { CAPABILITIES } from '@/lib/capabilities';
import { BASEMAP_ORIGIN as APP_BASEMAP_ORIGIN, BASEMAP_TILEJSON_URL } from '@/lib/map/basemap-urls';
import {
  BASEMAP_ORIGIN,
  BASEMAP_VECTOR_TILE,
  classifyRenderer,
  collectFailures,
  commandLineProblems,
  EVIDENCE_FILE,
  featureStatusProblem,
  flagProblems,
  IN_RUN_AUDIT,
  inspectRun,
  launchOptions,
  main,
  MAP_CANVAS,
  MAPLIBRE_WORKER_PATH,
  MASKED_RENDERER,
  PLAYWRIGHT_DEFAULTS_DROPPED,
  readGpuConfig,
  RUNS_EVIDENCE_FILE,
  runsSummaryMarkdown,
  SOFTWARE_RENDERER,
  splitFlags,
  summaryMarkdown,
  verifyRuns,
  webglStatus,
  workflowCommandData,
  type BrowserObservation,
  type BrowserReport,
  type Evidence,
  type LhrLike,
  type RunExpectations,
  type RunsEvidence,
} from './gpu-renderer-check';

const root = path.resolve(import.meta.dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');
const scratch: string[] = [];
const tmpDir = (prefix: string) => {
  const d = mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(d);
  return d;
};
afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

interface YamlModule {
  load?: (s: string) => unknown;
  safeLoad?: (s: string) => unknown;
}
/**
 * js-yaml is present through @lhci/cli; resolve it as a direct dependency when the lead adds one,
 * otherwise from pnpm's hoisted virtual store (default `hoist-pattern: *`).
 */
function loadYaml(source: string): unknown {
  const require = createRequire(import.meta.url);
  let mod: YamlModule;
  try {
    mod = require('js-yaml') as YamlModule;
  } catch {
    mod = require(path.join(root, 'node_modules/.pnpm/node_modules/js-yaml')) as YamlModule;
  }
  const parse = mod.safeLoad ?? mod.load;
  if (!parse) throw new Error('js-yaml has no load function');
  return parse(source);
}

type Step = { name?: string; uses?: string; run?: string; with?: Record<string, unknown>; if?: string; 'continue-on-error'?: unknown };
type Job = {
  name?: string;
  'runs-on': string | string[];
  'timeout-minutes'?: number;
  permissions?: Record<string, string>;
  env?: Record<string, string>;
  if?: string;
  needs?: unknown;
  'continue-on-error'?: unknown;
  steps: Step[];
  container?: { image: string; options?: string };
};
type Workflow = { on: Record<string, unknown>; permissions: Record<string, string>; env: Record<string, string>; jobs: Record<string, Job> };

const WORKFLOW_TEXT = read('.github/workflows/ci.yml');
const LHCI_GPU_COLLECT = 'pnpm exec lhci collect --config=./lighthouserc.gpu.json';
const LHCI_GPU_ASSERT = 'pnpm exec lhci assert --config=./lighthouserc.gpu.json';
const LHCI_GPU_UPLOAD = 'pnpm exec lhci upload --config=./lighthouserc.gpu.json';

describe('.github/workflows/ci.yml', () => {
  const wf = loadYaml(WORKFLOW_TEXT) as Workflow;
  const steps = Object.values(wf.jobs).flatMap((j) => j.steps);
  const runs = steps.map((s) => s.run ?? '');

  it('runs on every push and pull request with read-only permissions', () => {
    expect(Object.keys(wf.on).sort()).toEqual(['pull_request', 'push']);
    expect(wf.permissions).toEqual({ contents: 'read' });
  });

  it('runs every quality gate', () => {
    for (const cmd of [
      'pnpm install --frozen-lockfile',
      'pnpm lint',
      'pnpm typecheck',
      'pnpm test:coverage',
      'pnpm build',
      'pnpm lhci',
      'pnpm lhci:gpu:check',
      'pnpm lhci:gpu:verify',
      LHCI_GPU_ASSERT,
      LHCI_GPU_UPLOAD,
      'pnpm audit --prod --audit-level high',
    ]) {
      expect(runs, cmd).toContain(cmd);
    }
    expect(runs.some((r) => r.split('\n').includes(LHCI_GPU_COLLECT))).toBe(true);
    // e2e runs in the official Playwright image (same version as @playwright/test, pinned by digest),
    // with a per-test budget above the 90 s map-canvas waits in e2e/map-engine/helpers.ts.
    const pkg = JSON.parse(read('package.json')) as { devDependencies: Record<string, string> };
    const e2e = wf.jobs.e2e!;
    const version = pkg.devDependencies['@playwright/test']!;
    expect(e2e.container?.image.startsWith(`mcr.microsoft.com/playwright:v${version}-noble@sha256:`)).toBe(true);
    expect(e2e.container?.image).toMatch(/@sha256:[0-9a-f]{64}$/);
    const e2eRun = e2e.steps.map((s) => s.run ?? '').find((r) => r.startsWith('pnpm e2e'));
    const budget = Number(/--timeout=(\d+)/.exec(e2eRun ?? '')?.[1]);
    expect(budget).toBeGreaterThan(90_000);
    expect(read('e2e/map-engine/helpers.ts')).toContain('timeout: 90_000');
    // Sandbox-only switches never reach CI.
    expect(read('.github/workflows/ci.yml')).not.toMatch(/E2E_IGNORE_HTTPS_ERRORS|PLAYWRIGHT_CHROMIUM_EXECUTABLE/);
  });

  it('pins every action to a full commit SHA', () => {
    const uses = steps.map((s) => s.uses).filter(Boolean) as string[];
    expect(uses.length).toBeGreaterThan(5);
    for (const u of uses) expect(u, u).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
    // Every pin carries its version in a trailing comment.
    for (const line of WORKFLOW_TEXT.split('\n').filter((l) => /^\s*-?\s*uses:/.test(l))) expect(line).toMatch(/@[0-9a-f]{40} # v\d/);
  });

  it('hardens every job: no persisted credentials, least privilege, no pull_request_target, no expressions in scripts', () => {
    for (const [id, job] of Object.entries(wf.jobs)) {
      for (const s of job.steps.filter((st) => st.uses?.startsWith('actions/checkout@'))) expect(s.with?.['persist-credentials'], id).toBe(false);
      if (job.permissions) expect(job.permissions, id).toEqual({ contents: 'read' });
      // Context values reach scripts through env only (no template injection).
      for (const s of job.steps) expect(s.run ?? '', `${id}: ${s.name ?? s.run}`).not.toContain('${{');
    }
    expect(WORKFLOW_TEXT).not.toContain('pull_request_target');
    const artifacts = steps.filter((s) => s.uses?.startsWith('actions/upload-artifact@')).map((s) => s.with?.name);
    expect(new Set(artifacts).size).toBe(artifacts.length);
  });

  it('enforces catalogue completeness (every catalogued route exists)', () => {
    expect(wf.env.CHECK_CATALOG_COMPLETENESS).toBe('1');
  });

  it('fails the build on placeholder text in LICENSE, README and docs', () => {
    const quality = wf.jobs.quality!.steps.map((s) => s.run ?? '').join('\n');
    expect(quality).toContain(`grep -rnIP ${PLACEHOLDER_PCRE_QUOTED}`);
    expect(quality).toContain('--exclude-dir=reference --exclude=OPUS_5_5_BUILD_PROMPT.md');
  });
});

/**
 * Evaluates one of this workflow's `${{ }}` expressions as JavaScript: the operators, quoting,
 * property access and short-circuiting used here mean the same in both. GitHub reads an unset
 * repository variable as '' (its loose comparison treats null like ''), so fixtures pass ''.
 */
function evalExpression(expr: string, ctx: { vars: Record<string, string>; github: Record<string, unknown> }): unknown {
  const body = /^\$\{\{([\s\S]*)\}\}$/.exec(expr.trim())?.[1];
  if (!body) throw new Error(`not an expression: ${expr}`);
  const fn = new Function('vars', 'github', 'startsWith', 'fromJSON', `return (${body});`) as (...args: unknown[]) => unknown;
  const startsWith = (s: unknown, prefix: unknown) => String(s).toLowerCase().startsWith(String(prefix).toLowerCase());
  return fn(ctx.vars, ctx.github, startsWith, (s: string) => JSON.parse(s) as unknown);
}

const REPO = 'awne8886/godseye';
const pushRun = (runner: string) => ({ vars: { LIGHTHOUSE_GPU_RUNNER: runner }, github: { event_name: 'push', repository: REPO, event: {} } });
const prRun = (runner: string, head: string | null) => ({
  vars: { LIGHTHOUSE_GPU_RUNNER: runner },
  github: { event_name: 'pull_request', repository: REPO, event: { pull_request: { head: { repo: { full_name: head } } } } },
});

/** Runs a workflow `run:` script the way GitHub's default shell does (`bash --noprofile --norc -eo pipefail`). */
function runStep(script: string, opts: { cwd?: string; env?: Record<string, string> } = {}) {
  return spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], {
    cwd: opts.cwd,
    env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '', ...opts.env },
    encoding: 'utf8',
  });
}

/** A directory of executable stubs that record their arguments to calls.log and exit with `code`. */
function stubBin(names: Record<string, number>): { bin: string; calls: () => string } {
  const dir = tmpDir('godseye-stub-');
  const bin = path.join(dir, 'bin');
  mkdirSync(bin);
  const log = path.join(dir, 'calls.log');
  for (const [name, code] of Object.entries(names)) {
    writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\nexit ${code}\n`, { mode: 0o755 });
  }
  return { bin, calls: () => (existsSync(log) ? readFileSync(log, 'utf8') : '') };
}

describe('Lighthouse on / runs only on a GPU runner (job lighthouse-gpu)', () => {
  const wf = loadYaml(WORKFLOW_TEXT) as Workflow;
  const job = wf.jobs['lighthouse-gpu']!;
  const runsOn = job['runs-on'] as string;
  const trusted = job.env?.TRUSTED_SOURCE ?? '';
  const idx = (pred: (s: Step) => boolean) => job.steps.findIndex(pred);

  it('takes its runner from the LIGHTHOUSE_GPU_RUNNER variable: a label or a JSON array of labels', () => {
    expect(runsOn).toContain('vars.LIGHTHOUSE_GPU_RUNNER');
    expect(evalExpression(runsOn, pushRun('gpu-t4-4core'))).toBe('gpu-t4-4core');
    expect(evalExpression(runsOn, pushRun('["self-hosted","linux","x64","godseye-gpu"]'))).toEqual(['self-hosted', 'linux', 'x64', 'godseye-gpu']);
    expect(evalExpression(runsOn, prRun('gpu-t4-4core', REPO))).toBe('gpu-t4-4core');
  });

  it('falls back to ubuntu-24.04, where the first step fails, when the variable is unset or the run comes from a fork', () => {
    expect(evalExpression(runsOn, pushRun(''))).toBe('ubuntu-24.04');
    expect(evalExpression(runsOn, prRun('gpu-t4-4core', 'someone/godseye'))).toBe('ubuntu-24.04');
    expect(evalExpression(runsOn, prRun('gpu-t4-4core', null))).toBe('ubuntu-24.04');
    expect(evalExpression(trusted, pushRun('gpu-t4-4core'))).toBe(true);
    expect(evalExpression(trusted, prRun('gpu-t4-4core', REPO))).toBe(true);
    expect(evalExpression(trusted, prRun('gpu-t4-4core', 'someone/godseye'))).toBe(false);
    expect(evalExpression(job.env?.GPU_RUNNER ?? '', pushRun('gpu-t4-4core'))).toBe('gpu-t4-4core');
  });

  it('fails fast with an ::error naming the setting, before anything else runs, and does not publish the label', () => {
    const first = job.steps[0]!;
    expect(first.uses).toBeUndefined();
    expect(first.if).toBeUndefined();
    const sh = (env: Record<string, string>) => runStep(first.run ?? '', { env: { RUNNER_NAME: 'test-runner', ...env } });
    const unset = sh({ GPU_RUNNER: '', TRUSTED_SOURCE: 'true' });
    expect(unset.status).toBe(1);
    expect(unset.stdout).toMatch(/^::error title=[^:]+::The repository variable LIGHTHOUSE_GPU_RUNNER is empty.*Settings > Secrets and variables > Actions > Variables/m);
    const fork = sh({ GPU_RUNNER: 'gpu-t4-4core', TRUSTED_SOURCE: 'false' });
    expect(fork.status).toBe(1);
    expect(fork.stdout).toMatch(/^::error title=[^:]+::Pull requests from forks never run on the GPU runner/m);
    const ok = sh({ GPU_RUNNER: 'gpu-t4-4core', TRUSTED_SOURCE: 'true' });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toBe('Running on test-runner\n');
    // Dependabot-triggered runs do receive repository variables; the workflow must not claim otherwise.
    expect(WORKFLOW_TEXT).not.toMatch(/dependabot/i);
  });

  it('is never skipped or allowed to fail, with least privilege and a timeout', () => {
    expect(job.if).toBeUndefined();
    expect(job.needs).toBeUndefined();
    expect(job['continue-on-error']).toBeUndefined();
    for (const s of job.steps) expect(s['continue-on-error'], s.name ?? s.run).toBeUndefined();
    expect(job.permissions).toEqual({ contents: 'read' });
    expect(job['timeout-minutes']).toBeGreaterThan(0);
    expect(job['timeout-minutes']).toBeLessThanOrEqual(30);
  });

  it('builds, pre-checks, collects, verifies every run, then asserts and writes reports, in that order', () => {
    const checkout = idx((s) => s.uses?.startsWith('actions/checkout@') ?? false);
    const chromePath = idx((s) => /CHROME_PATH=.*chromium\.executablePath\(\).*>> "\$GITHUB_ENV"/.test(s.run ?? ''));
    const build = idx((s) => s.run === 'pnpm build');
    const check = idx((s) => s.run === 'pnpm lhci:gpu:check');
    const collect = idx((s) => (s.run ?? '').split('\n').includes(LHCI_GPU_COLLECT));
    const verify = idx((s) => s.run === 'pnpm lhci:gpu:verify');
    const assertStep = idx((s) => s.run === LHCI_GPU_ASSERT);
    const reports = idx((s) => s.run === LHCI_GPU_UPLOAD);
    const upload = idx((s) => s.uses?.startsWith('actions/upload-artifact@') ?? false);
    expect(checkout).toBeGreaterThan(0);
    expect(chromePath).toBeGreaterThan(checkout);
    expect(build).toBeGreaterThan(chromePath);
    expect(check).toBeGreaterThan(build);
    expect([collect, verify, assertStep, reports]).toEqual([check + 1, check + 2, check + 3, check + 4]);
    expect(upload).toBeGreaterThan(reports);
    // The gates and the measurement run only when every earlier step succeeded; nothing runs autorun.
    for (const i of [check, collect, verify, assertStep, reports]) expect(job.steps[i]!.if, job.steps[i]!.name).toBeUndefined();
    expect(job.steps.map((s) => s.run ?? '').join('\n')).not.toContain('autorun');
    expect(job.steps[upload]!.if).toBe('always()');
    expect(job.steps[upload]!.with).toMatchObject({ name: 'lighthouse-gpu', path: '.lighthouseci/' });
    // No software GL in this job; root (apt) only on GitHub-hosted runners.
    expect(job.steps.map((s) => s.run ?? '').join('\n')).not.toMatch(/swiftshader|xvfb/i);
    for (const s of job.steps.filter((st) => /\bsudo\b|--with-deps/.test(st.run ?? ''))) expect(s.if).toBe("runner.environment == 'github-hosted'");
  });

  it('collects only after a passing pre-check is on record', () => {
    const step = job.steps.find((s) => (s.run ?? '').split('\n').includes(LHCI_GPU_COLLECT))!;
    const cwd = tmpDir('godseye-collect-');
    const { bin, calls } = stubBin({ pnpm: 0 });
    const run = () => runStep(step.run ?? '', { cwd, env: { PATH: `${bin}:${process.env.PATH ?? ''}` } });
    const missing = run();
    expect(missing.status).toBe(1);
    expect(missing.stdout).toMatch(/^::error title=Lighthouse on \/ not measured::No passing hardware-WebGL2 pre-check/m);
    mkdirSync(path.join(cwd, '.lighthouseci'));
    writeFileSync(path.join(cwd, EVIDENCE_FILE), JSON.stringify({ ok: false }));
    expect(run().status).toBe(1);
    expect(calls()).toBe('');
    writeFileSync(path.join(cwd, EVIDENCE_FILE), JSON.stringify({ ok: true }));
    expect(run().status).toBe(0);
    expect(calls()).toBe('pnpm exec lhci collect --config=./lighthouserc.gpu.json\n');
  });

  it('GPU diagnostics never fail the job (a broken nvidia-smi or Chromium binary only prints a note)', () => {
    const step = job.steps.find((s) => s.name === 'GPU diagnostics')!;
    const { bin } = stubBin({ 'nvidia-smi': 9 });
    const r = runStep(step.run ?? '', { env: { PATH: `${bin}:${process.env.PATH ?? ''}`, CHROME_PATH: '/bin/false' } });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('nvidia-smi failed');
    expect(r.stdout).toContain('chrome --version failed');
  });

  it('keeps /docs and /privacy on ubuntu-24.04 with lighthouserc.json', () => {
    const pages = wf.jobs['lighthouse-pages']!;
    expect(pages['runs-on']).toBe('ubuntu-24.04');
    expect(pages.steps.map((s) => s.run)).toContain('pnpm lhci');
  });
});

/** The CI grep pattern (PCRE); "TODO.md" as a file name is allowed. */
const PLACEHOLDER_PCRE = String.raw`(?i:none yet)|\bTODO\b(?!\.md)|\bFIXME\b|\bTBD\b|(?i:lorem ipsum)`;
const PLACEHOLDER_PCRE_QUOTED = `'${PLACEHOLDER_PCRE}'`;

describe('shipped docs carry no placeholders', () => {
  const files = ['LICENSE', 'README.md'];
  const walk = (dir: string) => {
    for (const name of readdirSync(path.join(root, dir))) {
      const rel = path.join(dir, name);
      if (rel === path.join('docs', 'reference') || name === 'OPUS_5_5_BUILD_PROMPT.md') continue;
      if (statSync(path.join(root, rel)).isDirectory()) walk(rel);
      else if (name.endsWith('.md')) files.push(rel);
    }
  };
  walk('docs');
  // Same rule as the CI grep, in JavaScript regex syntax (inline (?i:) groups spelled out).
  const bad = /none yet|lorem ipsum/i;
  const badCase = /\bTODO\b(?!\.md)|\bFIXME\b|\bTBD\b/;

  it.each(files)('%s', (f) => {
    const hits = read(f)
      .split('\n')
      .map((line, i) => `${i + 1}: ${line}`)
      .filter((line) => bad.test(line) || badCase.test(line));
    expect(hits).toEqual([]);
  });

  it('agrees with the CI grep where GNU grep -P is available', () => {
    let out = '';
    try {
      out = execFileSync('grep', ['-rnP', PLACEHOLDER_PCRE, 'LICENSE', 'README.md', 'docs', '--exclude-dir=reference', '--exclude=OPUS_5_5_BUILD_PROMPT.md'], { cwd: root, encoding: 'utf8' });
    } catch (e) {
      // Exit 1 = no match (pass); 2 = grep without PCRE support (the in-process check above still ran).
      if ((e as { status?: number }).status !== 1) return;
    }
    expect(out).toBe('');
  });
});

describe('docker-compose.yml, Caddyfile and Dockerfile', () => {
  type Service = {
    image?: string;
    build?: unknown;
    ports?: string[];
    expose?: string[];
    profiles?: string[];
    environment?: Record<string, string>;
    read_only?: boolean;
    tmpfs?: string[];
    security_opt?: string[];
    cap_drop?: string[];
    cap_add?: string[];
    user?: string;
  };
  const compose = loadYaml(read('docker-compose.yml')) as { services: Record<string, Service> };

  it('publishes only Caddy; the app is reachable from the compose network only', () => {
    const { app, caddy, redis } = compose.services;
    expect(app?.build).toBeDefined();
    expect(app?.ports).toBeUndefined();
    expect(app?.expose).toEqual(['3000']);
    expect(caddy?.ports).toEqual(expect.arrayContaining(['80:80', '443:443']));
    expect(redis?.profiles).toEqual(['redis']);
    expect(redis?.ports).toBeUndefined();
    expect(app?.environment?.TRUSTED_PROXY_HOPS).toBe('1');
  });

  it('hardens every container: read-only rootfs, no-new-privileges, all capabilities dropped (SEC-m10)', () => {
    for (const [name, svc] of Object.entries(compose.services)) {
      expect(svc.read_only, name).toBe(true);
      expect(svc.security_opt, name).toContain('no-new-privileges:true');
      expect(svc.cap_drop, name).toEqual(['ALL']);
    }
    const { app, caddy, redis } = compose.services;
    expect(app?.cap_add).toBeUndefined();
    expect(caddy?.cap_add).toEqual(['NET_BIND_SERVICE']);
    expect(redis?.cap_add).toBeUndefined();
    expect(redis?.user).toBe('999:999');
    // The app's only writable paths: the /data volume, /tmp and the next/image cache (owned by uid 1001).
    expect(app?.tmpfs).toEqual(['/tmp:size=64m,mode=1777', '/app/.next/cache:size=256m,uid=1001,gid=1001,mode=0700']);
  });

  it('Caddy compresses JSON and pages but never event streams', () => {
    const caddyfile = read('Caddyfile');
    expect(caddyfile).toMatch(/^\s*encode zstd gzip \{/m);
    expect(caddyfile).toContain('header Content-Type application/json*');
    expect(caddyfile).toContain('header Content-Type text/html*');
    expect(caddyfile).not.toMatch(/header Content-Type text\/(\*|event-stream)/);
  });

  it('Caddy overwrites the client-IP headers and streams SSE unbuffered', () => {
    const caddyfile = read('Caddyfile');
    expect(caddyfile).toContain('header_up X-Forwarded-For {remote_host}');
    expect(caddyfile).toContain('header_up X-Real-IP {remote_host}');
    expect(caddyfile).toContain('flush_interval -1');
    expect(caddyfile).not.toMatch(/^\s*log\b/m);
  });

  it('Caddy caps request bodies: 64 KB on /api/ai/*, 1 MB elsewhere, above the app caps (SEC2-m8)', () => {
    const caddyfile = read('Caddyfile');
    expect(caddyfile).toMatch(/^\s*@ai_body path \/api\/ai\/\*$/m);
    expect(caddyfile).toMatch(/request_body @ai_body \{\s*max_size 64KB\s*\}/);
    expect(caddyfile).toMatch(/^\s*@other_body not path \/api\/ai\/\*$/m);
    expect(caddyfile).toMatch(/request_body @other_body \{\s*max_size 1MB\s*\}/);
    // The proxy limit must never be tighter than what the app itself accepts (Caddy units are decimal).
    const ai = read('src/components/panels/intel/server/ai-route.ts').match(/MAX_BODY_BYTES = (\d+) \* 1024/);
    const sdk = read('src/features/network/server/sdk.ts').match(/MAX_BODY_BYTES = (\d+) \* 1024/);
    expect(Number(ai?.[1]) * 1024).toBeLessThanOrEqual(64_000);
    expect(Number(sdk?.[1]) * 1024).toBeLessThanOrEqual(1_000_000);
  });

  it('pins the Caddy and Redis images by digest (SEC2-m9)', () => {
    const { caddy, redis } = compose.services;
    expect(caddy?.image).toMatch(/^caddy:2-alpine@sha256:[0-9a-f]{64}$/);
    expect(redis?.image).toMatch(/^redis:8-alpine@sha256:[0-9a-f]{64}$/);
    // Every digest is recorded in the probe log with its resolution date.
    const log = read('docs/data-sources/pages-docs-privacy-ops.md');
    for (const img of [caddy?.image, redis?.image]) expect(log).toContain(img?.split('@')[1]);
  });

  it('Dockerfile: frozen install, `pnpm build`, standalone + static + public, non-root, healthcheck, no secrets', () => {
    const df = read('Dockerfile');
    expect(df).toContain('corepack enable');
    expect(df).toContain('pnpm install --frozen-lockfile');
    expect(df).toMatch(/^RUN pnpm build$/m);
    const instructions = df.split('\n').filter((l) => !l.trimStart().startsWith('#')).join('\n');
    expect(instructions).not.toMatch(/next build/);
    for (const copy of ['/app/.next/standalone ./', '/app/.next/static ./.next/static', '/app/public ./public']) expect(df).toContain(copy);
    expect(df).toMatch(/^USER godseye$/m);
    // Base image pinned by digest; no package managers or login shell at run time; the cache dir
    // pre-created for the tmpfs that a read-only root filesystem needs.
    expect(df).toMatch(/^ARG NODE_IMAGE=node:22-alpine@sha256:[0-9a-f]{64}$/m);
    expect(df).toContain('-s /sbin/nologin');
    expect(df).toContain('rm -rf /usr/local/lib/node_modules/npm');
    expect(df).toContain('chown godseye:godseye /data /app/.next/cache');
    const runtime = df.slice(df.indexOf('AS runner'));
    expect(runtime).not.toMatch(/corepack enable|RUN pnpm/);
    expect(df).toMatch(/HEALTHCHECK[\s\S]*\/api\/health/);
    expect(df).not.toMatch(/^(ENV|ARG)\s+[^\n]*(KEY|TOKEN|SECRET|PASSWORD)/im);
    const ignore = read('.dockerignore').split('\n');
    for (const entry of ['.env', '.env.*', '.git', 'node_modules', '.next', 'lighthouserc.json', 'lighthouserc.gpu.json', 'tools/lighthouse']) expect(ignore).toContain(entry);
  });
});


type Assertion = [string, Record<string, number | string>];
type LhciConfig = {
  ci: {
    collect: {
      startServerCommand: string;
      startServerReadyPattern: string;
      startServerReadyTimeout: number;
      url: string[];
      numberOfRuns: number;
      settings: { preset?: string; configPath?: string; pauseAfterLoadMs: number; chromeFlags: string };
    };
    assert: { assertions: Record<string, Assertion> };
    upload: { target: string; outputDir: string };
  };
};

const GPU_CONFIG_MODULE = './tools/lighthouse/gpu-config.mjs';
/** Loads one of the tools/lighthouse/*.mjs modules (plain ESM, run by Lighthouse itself). */
const loadMjs = async <T>(rel: string): Promise<T> => (await import(pathToFileURL(path.join(root, rel)).href)) as T;

describe('Lighthouse configs', () => {
  const pages = JSON.parse(read('lighthouserc.json')) as LhciConfig;
  const gpu = JSON.parse(read('lighthouserc.gpu.json')) as LhciConfig;
  const paths = (c: LhciConfig) => c.ci.collect.url.map((u) => new URL(u).pathname);
  const contract = (c: LhciConfig) => Object.fromEntries(Object.entries(c.ci.assert.assertions).filter(([id]) => id !== IN_RUN_AUDIT));

  it.each([
    ['lighthouserc.json', pages],
    ['lighthouserc.gpu.json', gpu],
  ] as const)('%s asserts the contract thresholds as errors on the median of three runs, and nothing else changes what is measured', (_, c) => {
    const a = contract(c);
    expect(a['categories:performance']![1].minScore).toBe(0.85);
    expect(a['categories:accessibility']![1].minScore).toBe(1);
    expect(a['largest-contentful-paint']![1].maxNumericValue).toBe(2500);
    expect(a['cumulative-layout-shift']![1].maxNumericValue).toBe(0.1);
    expect(a['total-blocking-time']![1].maxNumericValue).toBe(300);
    expect(Object.keys(a)).toHaveLength(5);
    for (const [, [level, opts]] of Object.entries(a)) {
      expect(level).toBe('error');
      expect(opts.aggregationMethod).toBe('median-run');
    }
    expect(c.ci.collect.numberOfRuns).toBe(3);
    // Exact key sets: a setting such as throttlingMethod, chromePath or puppeteerScript cannot slip in.
    expect(Object.keys(c.ci.collect).sort()).toEqual(['numberOfRuns', 'settings', 'startServerCommand', 'startServerReadyPattern', 'startServerReadyTimeout', 'url']);
    expect(Object.keys(c.ci.assert)).toEqual(['assertions']);
    expect(c.ci.upload).toEqual({ target: 'filesystem', outputDir: '.lighthouseci' });
    const port = /--port (\d+)/.exec(c.ci.collect.startServerCommand)?.[1];
    for (const u of c.ci.collect.url) expect(new URL(u).port).toBe(port);
  });

  it('desktop settings: the pages config by preset, the GPU config by a module that spreads the desktop config (Lighthouse ignores preset with a config path)', () => {
    expect(pages.ci.collect.settings).toEqual({ preset: 'desktop', pauseAfterLoadMs: 9000, chromeFlags: expect.any(String) });
    expect(gpu.ci.collect.settings).toEqual({ configPath: GPU_CONFIG_MODULE, pauseAfterLoadMs: 9000, chromeFlags: expect.any(String) });
  });

  it('the GPU config asserts the contract assertions unchanged plus the in-run hardware audit on every run', () => {
    const { [IN_RUN_AUDIT]: inRun, ...rest } = gpu.ci.assert.assertions;
    expect(rest).toEqual(pages.ci.assert.assertions);
    expect(inRun).toEqual(['error', { minScore: 1, aggregationMethod: 'pessimistic' }]);
    expect(Object.keys(gpu.ci.assert.assertions)).toHaveLength(6);
    expect(gpu.ci.upload).toEqual(pages.ci.upload);
    const server = (c: LhciConfig) => ({ ...c.ci.collect, url: [], settings: {} });
    expect(server(gpu)).toEqual(server(pages));
  });

  it('cover exactly /, /docs and /privacy between them, with / only in the GPU config', () => {
    expect(paths(gpu)).toEqual(['/']);
    expect(paths(pages)).toEqual(['/docs', '/privacy']);
    expect([...paths(pages), ...paths(gpu)].sort()).toEqual(['/', '/docs', '/privacy']);
  });

  it('the GPU config selects hardware GL: no SwiftShader, GPU enabled, new headless', () => {
    const flags = splitFlags(gpu.ci.collect.settings.chromeFlags);
    expect(flags.join(' ')).not.toMatch(/swiftshader|--disable-gpu\b/i);
    expect(flagProblems(flags)).toEqual([]);
    expect(flags).toEqual(expect.arrayContaining(['--headless=new', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan']));
    // The renderer check reads the very file the GPU job hands to Lighthouse CI.
    expect(readGpuConfig(path.join(root, 'lighthouserc.gpu.json'), root)).toEqual({
      urls: gpu.ci.collect.url,
      runs: 3,
      flags,
      configPath: path.join(root, 'tools/lighthouse/gpu-config.mjs'),
      server: { command: 'pnpm start --port 3200', readyPattern: 'Ready', timeoutMs: 90_000 },
    });
  });

  it('readGpuConfig refuses LHCI settings under which Lighthouse would run another browser than CHROME_PATH', () => {
    const dir = tmpDir('godseye-lhrc-');
    const variant = (edit: (c: LhciConfig & { ci: { collect: Record<string, unknown> } }) => void) => {
      const c = JSON.parse(read('lighthouserc.gpu.json')) as LhciConfig & { ci: { collect: Record<string, unknown> } };
      edit(c);
      const f = path.join(dir, `rc-${scratch.length}-${Math.round(performance.now() * 1000)}.json`);
      writeFileSync(f, JSON.stringify(c));
      return () => readGpuConfig(f, root);
    };
    for (const key of ['chromePath', 'puppeteerScript', 'puppeteerLaunchOptions', 'headful']) {
      expect(variant((c) => (c.ci.collect[key] = key === 'headful' ? true : '/x')), key).toThrow(new RegExp(`ci\\.collect\\.${key}`));
    }
    expect(variant((c) => ((c.ci.collect.settings as Record<string, unknown>).port = 9222))).toThrow(/settings\.port/);
    expect(variant((c) => (c.ci.collect.url = []))).toThrow(/lists no page/);
  });

  it('package.json: `pnpm lhci` measures the pages config; `pnpm lhci:gpu` runs pre-check, collect, verify, assert, upload', () => {
    const { scripts } = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    const tool = 'node --experimental-transform-types --disable-warning=ExperimentalWarning tools/gpu-renderer-check.ts';
    expect(scripts.lhci).toBe('lhci autorun --config=./lighthouserc.json');
    expect(scripts['lhci:gpu:check']).toBe(`${tool} lighthouserc.gpu.json`);
    expect(scripts['lhci:gpu:verify']).toBe(`${tool} --verify-runs lighthouserc.gpu.json`);
    expect(scripts['lhci:gpu']).toBe(
      'pnpm lhci:gpu:check && lhci collect --config=./lighthouserc.gpu.json && pnpm lhci:gpu:verify && lhci assert --config=./lighthouserc.gpu.json && lhci upload --config=./lighthouserc.gpu.json',
    );
  });
});

/** Recorded 2026-10-01 in the build sandbox (no GPU) on Chrome for Testing 153.0.8010.12 and Chromium 141.0.7390.37 with SwiftShader flags. */
const SWIFTSHADER_RENDERER = 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)';
/** Shape of an ANGLE hardware renderer string (the sandbox has no GPU; Tesla T4 is PCI 10de:1eb8). */
const T4_RENDERER = 'ANGLE (NVIDIA, Vulkan 1.3.277 (NVIDIA Tesla T4 (0x00001EB8)), NVIDIA)';
/**
 * `SystemInfo.getInfo().commandLine` recorded by tools/gpu-renderer-check.ts on 2026-10-01 with the
 * binary CI uses (`chromium.executablePath()` after `playwright install --no-shell chromium`:
 * Chrome for Testing 153.0.8010.12, chromium-1243) and lighthouserc.gpu.json's flags.
 */
const RECORDED_COMMAND_LINE = [
  '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome --disable-background-networking --disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad',
  '--disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update',
  '--no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions',
  '--disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion',
  '--allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking',
  '--disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb',
  '--metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun',
  '--export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings',
  '--edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --no-sandbox',
  '--headless=new --no-sandbox --enable-gpu --ignore-gpu-blocklist --use-angle=vulkan --enable-features=Vulkan',
  '--disable-vulkan-surface --user-data-dir=/tmp/playwright_chromiumdev_profile-C4SUYZ --remote-debugging-pipe',
  '--no-startup-window --noerrdialogs --ozone-platform=headless --ozone-override-screen-size=800,600',
  '--flag-switches-begin --flag-switches-end',
].join(' ');

/** `SystemInfo.getInfo().gpu.featureStatus`, recorded 2026-10-01 in the build sandbox (no GPU). */
const FEATURE_STATUS = {
  /** Chromium 141.0.7390.37, lighthouserc.gpu.json flags: still reports `webgl2`. */
  chromium141GpuFlags: {
    '2d_canvas': 'disabled_software', direct_rendering_display_compositor: 'disabled_off_ok', gpu_compositing: 'disabled_software',
    multiple_raster_threads: 'disabled_off', opengl: 'disabled_off', rasterization: 'disabled_software', raw_draw: 'disabled_off_ok',
    skia_graphite: 'disabled_off', trees_in_viz: 'disabled_off', video_decode: 'disabled_software', video_encode: 'disabled_software',
    vulkan: 'disabled_off', webgl: 'disabled_off', webgl2: 'disabled_off', webgpu: 'disabled_off', webnn: 'disabled_off',
  },
  /** Chrome for Testing 153.0.8010.12 (the build CI installs), lighthouserc.gpu.json flags: no `webgl2` key any more. */
  cft153GpuFlags: {
    '2d_canvas': 'disabled_software', direct_rendering_display_compositor: 'disabled_off_ok', gpu_compositing: 'disabled_software',
    multiple_raster_threads: 'disabled_off', opengl: 'disabled_off', rasterization: 'disabled_software', raw_draw: 'disabled_off_ok',
    skia_graphite: 'disabled_off', trees_in_viz: 'disabled_off', video_decode: 'disabled_software', video_encode: 'disabled_software',
    vulkan: 'disabled_off', webgl: 'disabled_off', webgpu: 'disabled_off', webgpu_on_vk_via_gl_interop: 'disabled_off', webnn: 'disabled_off',
  },
  /** Chrome for Testing 153 with --enable-unsafe-swiftshader --use-angle=swiftshader: "enabled", so only the renderer string exposes SwiftShader. */
  cft153SwiftShader: {
    '2d_canvas': 'enabled', direct_rendering_display_compositor: 'disabled_off_ok', gpu_compositing: 'enabled', multiple_raster_threads: 'enabled_on',
    opengl: 'enabled_on', rasterization: 'enabled', raw_draw: 'disabled_off_ok', skia_graphite: 'disabled_off', trees_in_viz: 'disabled_off',
    video_decode: 'enabled', video_encode: 'disabled_software', vulkan: 'disabled_off', webgl: 'enabled', webgpu: 'unavailable_software',
    webgpu_on_vk_via_gl_interop: 'disabled_off', webnn: 'disabled_off',
  },
} as const;
/** Shape of Chrome 153's report on a hardware GPU (no `webgl2` key; the sandbox has no GPU). */
const FS_153_HARDWARE = { ...FEATURE_STATUS.cft153SwiftShader, vulkan: 'enabled_on', webgpu: 'enabled' };

describe('tools/gpu-renderer-check.ts: pre-check', () => {
  const gpuFlags = splitFlags((JSON.parse(read('lighthouserc.gpu.json')) as LhciConfig).ci.collect.settings.chromeFlags);
  const probe = (renderer: string | null, vendor: string | null = null) => ({ renderer, vendor, version: 'WebGL 2.0 (OpenGL ES 3.0 Chromium)' });
  const observation = (o: Partial<BrowserObservation>): BrowserObservation => ({
    flags: gpuFlags,
    commandLine: RECORDED_COMMAND_LINE,
    featureStatus: FS_153_HARDWARE,
    blank: probe(T4_RENDERER, 'Google Inc. (NVIDIA)'),
    refusing: probe(T4_RENDERER, 'Google Inc. (NVIDIA)'),
    ...o,
  });

  it('classifies software rasterisers as software, whatever the GPU flags say', () => {
    expect(classifyRenderer(probe(SWIFTSHADER_RENDERER, 'Google Inc. (Google)'))).toBe('software');
    // Shapes of Mesa and Windows software renderer strings (no such renderer in the sandbox).
    expect(classifyRenderer(probe('ANGLE (Mesa, llvmpipe (LLVM 15.0.7, 256 bits), OpenGL 4.5)'))).toBe('software');
    expect(classifyRenderer(probe('ANGLE (Mesa, Vulkan 1.3.255 (llvmpipe (LLVM 15.0.7, 256 bits)), lavapipe)'))).toBe('software');
    expect(classifyRenderer(probe('ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11)'))).toBe('software');
    expect(classifyRenderer(probe('Some GPU', 'Google SwiftShader'))).toBe('software');
  });

  it('accepts hardware renderers, and fails closed on masked, empty or missing contexts', () => {
    expect(classifyRenderer(probe(T4_RENDERER, 'Google Inc. (NVIDIA)'))).toBe('hardware');
    expect(classifyRenderer(probe('ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)'))).toBe('hardware');
    expect(classifyRenderer(probe('ANGLE (AMD, AMD Radeon RX 6600 (radeonsi, navi23, LLVM 15.0.7, DRM 3.49), OpenGL 4.6)'))).toBe('hardware');
    expect(classifyRenderer(probe('WebKit WebGL', 'WebKit'))).toBe('unknown');
    expect(classifyRenderer(probe(null))).toBe('unknown');
    expect(classifyRenderer(null)).toBe('unavailable');
  });

  it('rejects flags that select software GL or another headless mode', () => {
    const pagesFlags = splitFlags((JSON.parse(read('lighthouserc.json')) as LhciConfig).ci.collect.settings.chromeFlags);
    expect(flagProblems(pagesFlags)).toEqual([
      '--enable-unsafe-swiftshader selects software GL or disables the GPU',
      '--use-angle=swiftshader selects software GL or disables the GPU',
    ]);
    expect(flagProblems(['--headless=new', '--disable-gpu'])).toHaveLength(1);
    expect(flagProblems(['--headless=new', '--use-gl=osmesa'])).toHaveLength(1);
    expect(flagProblems(['--headless=new', '--disable-gpu-sandbox'])).toEqual([]);
    expect(flagProblems(['--headless', '--enable-gpu'])).toEqual(['--headless=new is required so this check and Lighthouse run the same headless mode']);
    expect(splitFlags(['--a --b', '--c'])).toEqual(['--a', '--b', '--c']);
  });

  it("checks Chromium's real command line: every config flag, none of the dropped Playwright defaults", () => {
    expect(PLAYWRIGHT_DEFAULTS_DROPPED).toEqual(['--enable-unsafe-swiftshader', '--disable-field-trial-config', '--enable-features=CDPScreenshotNewSurface']);
    expect(commandLineProblems(RECORDED_COMMAND_LINE, gpuFlags)).toEqual([]);
    expect(commandLineProblems(`${RECORDED_COMMAND_LINE} --enable-unsafe-swiftshader`, gpuFlags)).toEqual(['Chromium was launched with --enable-unsafe-swiftshader']);
    expect(commandLineProblems(`${RECORDED_COMMAND_LINE} --disable-field-trial-config`, gpuFlags)).toEqual(['Chromium was launched with --disable-field-trial-config']);
    expect(commandLineProblems(RECORDED_COMMAND_LINE.replace(' --use-angle=vulkan', ''), gpuFlags)).toEqual(['Chromium was not launched with --use-angle=vulkan']);
  });

  it('launches CHROME_PATH with the config flags and without the GPU-relevant Playwright defaults', () => {
    expect(launchOptions('/ci/chrome', gpuFlags)).toEqual({
      executablePath: '/ci/chrome',
      headless: false,
      args: gpuFlags,
      ignoreDefaultArgs: PLAYWRIGHT_DEFAULTS_DROPPED,
      timeout: 60_000,
    });
  });

  it("reads Chromium's WebGL status from `webgl2` (up to 141) or `webgl` (Chrome for Testing 153, which CI installs)", () => {
    expect(webglStatus(FEATURE_STATUS.chromium141GpuFlags)).toBe('disabled_off');
    expect(webglStatus(FEATURE_STATUS.cft153GpuFlags)).toBe('disabled_off');
    expect('webgl2' in FEATURE_STATUS.cft153GpuFlags).toBe(false);
    expect(featureStatusProblem(FS_153_HARDWARE)).toBeNull();
    expect(featureStatusProblem({ webgl: 'enabled' })).toBeNull();
    expect(featureStatusProblem({ webgl2: 'enabled', webgl: 'enabled' })).toBeNull();
    expect(featureStatusProblem(FEATURE_STATUS.cft153GpuFlags)).toBe('Chromium reports WebGL as "disabled_off", not hardware-enabled');
    expect(featureStatusProblem(FEATURE_STATUS.chromium141GpuFlags)).toMatch(/"disabled_off", not hardware-enabled/);
    expect(featureStatusProblem({ webgl2: 'unavailable_software' })).toMatch(/not hardware-enabled/);
    expect(featureStatusProblem({ webgl: 'enabled_software' })).toMatch(/not hardware-enabled/);
    expect(featureStatusProblem(undefined)).toMatch(/"missing"/);
  });

  it('collectFailures: the recorded no-GPU states of Chromium 141 and Chrome 153 fail; a hardware shape passes', () => {
    const noGpu = ['blank canvas: WebGL2 renderer is unavailable (no WebGL2 context)', 'Chromium reports WebGL as "disabled_off", not hardware-enabled'];
    expect(collectFailures(observation({ featureStatus: FEATURE_STATUS.cft153GpuFlags, blank: null, refusing: null }))).toEqual(noGpu);
    expect(collectFailures(observation({ featureStatus: FEATURE_STATUS.chromium141GpuFlags, blank: null, refusing: null }))).toEqual(noGpu);
    // Explicit SwiftShader on 153: WebGL "enabled", a caveat-refusing context exists; only the renderer string tells.
    const sw = probe(SWIFTSHADER_RENDERER, 'Google Inc. (Google)');
    expect(collectFailures(observation({ featureStatus: FEATURE_STATUS.cft153SwiftShader, blank: sw, refusing: sw }))).toEqual([
      `blank canvas: WebGL2 renderer is software: ${SWIFTSHADER_RENDERER} (Google Inc. (Google))`,
    ]);
    expect(collectFailures(observation({}))).toEqual([]);
    expect(collectFailures(observation({ refusing: null }))).toEqual([
      'blank canvas: Chromium reports a major performance caveat (failIfMajorPerformanceCaveat refused), i.e. software rendering',
    ]);
    expect(collectFailures(observation({ commandLine: `${RECORDED_COMMAND_LINE} --enable-unsafe-swiftshader` }))).toEqual(['Chromium was launched with --enable-unsafe-swiftshader']);
    expect(collectFailures(observation({ featureStatus: undefined }))).toEqual(['Chromium reports WebGL as "missing", not hardware-enabled']);
  });

  it('reports to the job summary and workflow commands without breaking their syntax, and does not claim to describe the scored runs', () => {
    const evidence: Evidence = {
      checkedAt: '2026-10-01T07:40:37.839Z',
      config: 'lighthouserc.gpu.json',
      chromePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome',
      chromiumVersion: '153.0.8010.12',
      flags: gpuFlags,
      commandLine: RECORDED_COMMAND_LINE,
      gpu: null,
      blank: { probe: probe('a | b'), verdict: 'hardware', refusingCaveatContext: true, webglStatus: 'enabled' },
      pages: [{ url: 'http://127.0.0.1:3200/', probe: probe(SWIFTSHADER_RENDERER), verdict: 'software', problem: 'x' }],
      failures: ['x'],
      ok: false,
    };
    const md = summaryMarkdown(evidence);
    expect(md).toContain('pre-check (separate launch of the same Chromium and chromeFlags): NOT a hardware GPU');
    expect(md).toContain('| blank canvas | a \\| b |');
    expect(md).toContain(`| http://127.0.0.1:3200/ (MapLibre canvas) | ${SWIFTSHADER_RENDERER} |`);
    expect(summaryMarkdown({ ...evidence, ok: true, failures: [] })).toContain('chromeFlags): hardware GPU');
    expect(workflowCommandData('50%\r\nnext')).toBe('50%25%0D%0Anext');
  });
});

type GpuConfigModule = { default: { extends: string; settings: RunExpectations['settings']; artifacts: { id: string; gatherer: string }[]; audits: string[]; categories: Record<string, { auditRefs: { id: string; weight: number }[] }> } };
type LhModule = { LIGHTHOUSE_ENTRY: string; desktopConfig: { settings: RunExpectations['settings'] } };
type ProbeArtifact = Record<string, unknown>;
type AuditModule = {
  default: { meta: { id: string; requiredArtifacts: string[] }; audit: (a: { MapWebGl: ProbeArtifact }) => { score: number; displayValue: string; details: Record<string, unknown> } };
  SOFTWARE_RENDERER: RegExp;
  MASKED: RegExp;
  AUDIT_ID: string;
  judgeMapWebGl: (p: ProbeArtifact | null) => { ok: boolean; displayValue: string };
  webglFeatureProblem: (fs: Record<string, string> | null | undefined) => string | null;
};

describe('tools/lighthouse: the in-run hardware audit', () => {
  const hardwareArtifact = (o: ProbeArtifact = {}): ProbeArtifact => ({
    canvas: true,
    context: true,
    renderer: T4_RENDERER,
    vendor: 'Google Inc. (NVIDIA)',
    version: 'WebGL 2.0 (OpenGL ES 3.0 Chromium)',
    hardwareContext: true,
    product: 'Chrome/153.0.8010.12',
    gpu: { featureStatus: FS_153_HARDWARE, devices: [], error: null },
    ...o,
  });

  it('uses the Lighthouse copy @lhci/cli runs (no second install) and spreads its desktop config', async () => {
    const lh = await loadMjs<LhModule>('tools/lighthouse/lighthouse-module.mjs');
    const require = createRequire(import.meta.url);
    const nodeRunner = require.resolve('@lhci/cli/src/collect/node-runner.js');
    expect(lh.LIGHTHOUSE_ENTRY).toBe(createRequire(nodeRunner).resolve('lighthouse'));
    const cfg = (await loadMjs<GpuConfigModule>(GPU_CONFIG_MODULE)).default;
    expect(cfg.extends).toBe('lighthouse:default');
    expect(cfg.settings).toBe(lh.desktopConfig.settings);
    expect(cfg.settings).toMatchObject({ formFactor: 'desktop', screenEmulation: { mobile: false } });
    expect(cfg.artifacts).toEqual([{ id: 'MapWebGl', gatherer: './map-webgl-gatherer.mjs' }]);
    expect(cfg.audits).toEqual(['./map-webgl-audit.mjs']);
    // Without a category Lighthouse drops the audit from the report.
    expect(cfg.categories.godseye?.auditRefs).toEqual([{ id: IN_RUN_AUDIT, weight: 1 }]);
    for (const rel of [cfg.artifacts[0]!.gatherer, cfg.audits[0]!]) expect(existsSync(path.join(root, 'tools/lighthouse', rel)), rel).toBe(true);
  });

  it('judges with the same rules as the pre-check (renderer regexes, map canvas, WebGL status)', async () => {
    const audit = await loadMjs<AuditModule>('tools/lighthouse/map-webgl-audit.mjs');
    const gatherer = await loadMjs<{ MAP_CANVAS: string }>('tools/lighthouse/map-webgl-gatherer.mjs');
    expect(audit.AUDIT_ID).toBe(IN_RUN_AUDIT);
    expect(audit.default.meta.id).toBe(IN_RUN_AUDIT);
    expect(audit.default.meta.requiredArtifacts).toEqual(['MapWebGl']);
    expect([audit.SOFTWARE_RENDERER.source, audit.SOFTWARE_RENDERER.flags]).toEqual([SOFTWARE_RENDERER.source, SOFTWARE_RENDERER.flags]);
    expect([audit.MASKED.source, audit.MASKED.flags]).toEqual([MASKED_RENDERER.source, MASKED_RENDERER.flags]);
    expect(gatherer.MAP_CANVAS).toBe(MAP_CANVAS);
    const maps: (Record<string, string> | undefined)[] = [...Object.values(FEATURE_STATUS), FS_153_HARDWARE, { webgl: 'enabled_software' }, { webgl2: 'unavailable_software' }, undefined];
    for (const fs of maps) {
      expect(audit.webglFeatureProblem(fs) === null, JSON.stringify(fs)).toBe(featureStatusProblem(fs) === null);
    }
  });

  it('scores 1 only for a hardware renderer on the map canvas with a caveat-free context and WebGL hardware-enabled', async () => {
    const { judgeMapWebGl, default: Audit } = await loadMjs<AuditModule>('tools/lighthouse/map-webgl-audit.mjs');
    expect(judgeMapWebGl(hardwareArtifact())).toEqual({ ok: true, displayValue: T4_RENDERER });
    expect(judgeMapWebGl(null)).toEqual({ ok: false, displayValue: 'no map canvas' });
    expect(judgeMapWebGl(hardwareArtifact({ canvas: false, context: false }))).toEqual({ ok: false, displayValue: 'no map canvas' });
    expect(judgeMapWebGl(hardwareArtifact({ context: false }))).toEqual({ ok: false, displayValue: 'no WebGL2 context on the map canvas' });
    expect(judgeMapWebGl(hardwareArtifact({ renderer: SWIFTSHADER_RENDERER }))).toEqual({ ok: false, displayValue: `software: ${SWIFTSHADER_RENDERER}` });
    expect(judgeMapWebGl(hardwareArtifact({ vendor: 'Google SwiftShader' })).ok).toBe(false);
    expect(judgeMapWebGl(hardwareArtifact({ renderer: 'WebKit WebGL' })).displayValue).toBe('unknown (masked): WebKit WebGL');
    expect(judgeMapWebGl(hardwareArtifact({ hardwareContext: false })).displayValue).toBe(`major performance caveat: ${T4_RENDERER}`);
    expect(judgeMapWebGl(hardwareArtifact({ gpu: { featureStatus: null, devices: [], error: 'x' } })).displayValue).toBe(`no GPU report (x): ${T4_RENDERER}`);
    expect(judgeMapWebGl(hardwareArtifact({ gpu: { featureStatus: FEATURE_STATUS.cft153GpuFlags, devices: [], error: null } })).ok).toBe(false);
    const result = Audit.audit({ MapWebGl: hardwareArtifact() });
    expect(result).toMatchObject({ score: 1, displayValue: T4_RENDERER, details: { type: 'debugdata', renderer: T4_RENDERER } });
    expect(Audit.audit({ MapWebGl: hardwareArtifact({ renderer: SWIFTSHADER_RENDERER }) }).score).toBe(0);
  });
});

/** Trimmed results of real `lhci collect` runs (tools/lighthouse/__fixtures__, capture notes inside). */
const lhrFixture = (name: string) => JSON.parse(read(`tools/lighthouse/__fixtures__/${name}`)) as LhrLike & { audits: Record<string, { score?: number | null; displayValue?: string; details?: Record<string, unknown> }> };

/** The recorded SwiftShader run with its in-run audit replaced by a hardware-shaped result (the sandbox has no GPU). */
const hardwareRun = (): LhrLike => {
  const lhr = lhrFixture('lhr-cft153-swiftshader.json');
  const d = lhr.audits[IN_RUN_AUDIT]!.details!;
  lhr.audits[IN_RUN_AUDIT] = {
    score: 1,
    displayValue: T4_RENDERER,
    details: { ...d, renderer: T4_RENDERER, vendor: 'Google Inc. (NVIDIA)', hardwareContext: true, gpu: { featureStatus: FS_153_HARDWARE, devices: [], error: null } },
  };
  return lhr;
};

describe('tools/gpu-renderer-check.ts --verify-runs: every scored run', () => {
  const expected = async (): Promise<RunExpectations> => ({
    settings: (await loadMjs<GpuConfigModule>(GPU_CONFIG_MODULE)).default.settings,
    chromiumVersion: '153.0.8010.12',
  });
  const config = { urls: ['http://127.0.0.1:3200/'], runs: 3 };

  it('a run without a globe (no WebGL in Lighthouse’s Chromium) fails, even though its fallback page is light', async () => {
    const lhr = lhrFixture('lhr-cft153-no-gpu.json');
    expect(lhr.audits[IN_RUN_AUDIT]?.score).toBe(0);
    const r = inspectRun('lhr-1.json', lhr, await expected());
    expect(r.renderer).toBe('no map canvas');
    expect(r.problems).toEqual([
      'globe not drawn on a hardware GPU in this run: no map canvas',
      'the MapLibre worker (/maplibre/<version>/maplibre-gl-worker.mjs) was not loaded with HTTP 200',
      `no basemap vector tile (${BASEMAP_ORIGIN}/planet/…/z/x/y.pbf) was loaded with HTTP 200`,
    ]);
  });

  it('a run that drew the globe with SwiftShader fails on its renderer; the worker and the vector tiles were seen', async () => {
    const r = inspectRun('lhr-2.json', lhrFixture('lhr-cft153-swiftshader.json'), await expected());
    expect(r.worker).toBe(true);
    expect(r.vectorTiles).toBeGreaterThan(10);
    expect(r.problems).toEqual([`globe not drawn on a hardware GPU in this run: software: ${SWIFTSHADER_RENDERER}`]);
  });

  it('a hardware run passes, and every missing piece of evidence fails it', async () => {
    const exp = await expected();
    expect(inspectRun('lhr-3.json', hardwareRun(), exp).problems).toEqual([]);
    const mutate = (edit: (l: LhrLike & { audits: Record<string, { details?: { items?: Record<string, unknown>[] } & Record<string, unknown>; score?: number | null }> }) => void) => {
      const lhr = hardwareRun() as LhrLike & { audits: Record<string, { details?: { items?: Record<string, unknown>[] } & Record<string, unknown>; score?: number | null }> };
      edit(lhr);
      return inspectRun('lhr-4.json', lhr, exp).problems;
    };
    const items = (l: { audits: Record<string, { details?: { items?: Record<string, unknown>[] } }> }) => l.audits['network-requests']!.details!.items!;
    expect(mutate((l) => (l.audits['network-requests']!.details!.items = items(l).filter((i) => !String(i.url).includes('maplibre-gl-worker'))))).toEqual([
      'the MapLibre worker (/maplibre/<version>/maplibre-gl-worker.mjs) was not loaded with HTTP 200',
    ]);
    expect(mutate((l) => items(l).forEach((i) => BASEMAP_VECTOR_TILE.test(String(i.url)) && (i.statusCode = 404)))).toHaveLength(1);
    expect(mutate((l) => (l.audits['errors-in-console'] = { details: { items: [{ source: 'other', description: 'WebGL: CONTEXT_LOST_WEBGL: loseContext: context lost' }] } }))).toEqual([
      'console error mentions WebGL: WebGL: CONTEXT_LOST_WEBGL: loseContext: context lost',
    ]);
    expect(mutate((l) => (l.configSettings = { ...l.configSettings, formFactor: 'mobile' }))).toEqual([expect.stringMatching(/^configSettings\.formFactor differs/)]);
    expect(mutate((l) => (l.configSettings = { ...l.configSettings, throttling: { rttMs: 150 } }))).toEqual([expect.stringMatching(/^configSettings\.throttling differs/)]);
    expect(mutate((l) => (l.audits[IN_RUN_AUDIT]!.details!.product = 'Chrome/141.0.7390.37'))).toEqual([expect.stringMatching(/not the pre-checked Chromium 153\.0\.8010\.12/)]);
    // A passing score with a software renderer or WebGL disabled in its details is still a failure.
    expect(mutate((l) => (l.audits[IN_RUN_AUDIT]!.details!.renderer = SWIFTSHADER_RENDERER))).toEqual([expect.stringMatching(/passed but its renderer is software/)]);
    expect(mutate((l) => (l.audits[IN_RUN_AUDIT]!.details!.gpu = { featureStatus: FEATURE_STATUS.cft153GpuFlags }))).toEqual([expect.stringMatching(/passed but Chromium reports WebGL as "disabled_off"/)]);
    expect(mutate((l) => delete l.audits[IN_RUN_AUDIT])).toEqual([expect.stringMatching(/is missing/), expect.stringMatching(/not the pre-checked/)]);
    expect(mutate((l) => (l.finalDisplayedUrl = 'http://127.0.0.1:3200/error'))).toEqual(['the page ended at http://127.0.0.1:3200/error, not http://127.0.0.1:3200/']);
    expect(inspectRun('lhr-5.json', hardwareRun(), { ...exp, chromiumVersion: null }).problems).toEqual([expect.stringMatching(/no pre-check version/)]);
  });

  it('requires numberOfRuns runs per URL and reports each run’s renderer with its scores in the job summary', async () => {
    const exp = await expected();
    const three = ['a', 'b', 'c'].map((k) => ({ file: `lhr-${k}.json`, lhr: hardwareRun() }));
    const ok = verifyRuns(three, config, exp);
    expect(ok.failures).toEqual([]);
    expect(verifyRuns(three.slice(0, 2), config, exp).failures).toEqual(['expected 3 Lighthouse runs (3 x 1 URL), found 2 lhr-*.json', 'http://127.0.0.1:3200/: 2 runs, expected 3']);
    const mixed = verifyRuns([...three.slice(0, 2), { file: 'lhr-d.json', lhr: lhrFixture('lhr-cft153-no-gpu.json') }], config, exp);
    expect(mixed.failures[0]).toBe('lhr-d.json (http://127.0.0.1:3200/): globe not drawn on a hardware GPU in this run: no map canvas');
    const evidence: RunsEvidence = {
      checkedAt: '2026-10-01T08:00:00.000Z',
      config: 'lighthouserc.gpu.json',
      chromePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome',
      chromiumVersion: '153.0.8010.12',
      expectedRuns: 3,
      runs: ok.runs,
      blankAfter: { probe: { renderer: T4_RENDERER, vendor: 'Google Inc. (NVIDIA)', version: null }, verdict: 'hardware', refusingCaveatContext: true, webglStatus: 'enabled' },
      failures: [],
      ok: true,
    };
    const md = runsSummaryMarkdown(evidence);
    expect(md).toContain('every run drew the globe on a hardware GPU');
    expect(md).toContain(`| lhr-a.json | http://127.0.0.1:3200/ | ${T4_RENDERER} |`);
    expect(md).toContain(`After the runs, blank canvas: hardware: ${T4_RENDERER}`);
    expect(runsSummaryMarkdown({ ...evidence, ok: false, failures: mixed.failures })).toContain('NOT verified on a hardware GPU');
  });

  it('the worker path and basemap origin match the app', () => {
    expect(BASEMAP_ORIGIN).toBe(APP_BASEMAP_ORIGIN);
    expect(BASEMAP_TILEJSON_URL.startsWith(`${BASEMAP_ORIGIN}/planet`)).toBe(true);
    expect(read('src/components/map/MapView.tsx')).toContain('maplibregl.setWorkerUrl(`/maplibre/${maplibregl.getVersion()}/maplibre-gl-worker.mjs`)');
    expect(MAPLIBRE_WORKER_PATH.test('/maplibre/6.11.2/maplibre-gl-worker.mjs')).toBe(true);
    expect(BASEMAP_VECTOR_TILE.test('https://tiles.openfreemap.org/planet/20260927_080001_pt/3/4/2.pbf')).toBe(true);
    // Glyph ranges are .pbf too, but they are not map tiles.
    expect(BASEMAP_VECTOR_TILE.test('https://tiles.openfreemap.org/fonts/Noto%20Sans%20Regular/0-255.pbf')).toBe(false);
  });
});

describe('tools/gpu-renderer-check.ts: main() and the CLI entry', () => {
  const tool = path.join(root, 'tools/gpu-renderer-check.ts');
  /** A copy of lighthouserc.gpu.json whose configPath is absolute, so a temporary working directory can use it. */
  const workdir = () => {
    const cwd = tmpDir('godseye-gpucheck-');
    const c = JSON.parse(read('lighthouserc.gpu.json')) as LhciConfig;
    c.ci.collect.settings.configPath = path.join(root, GPU_CONFIG_MODULE);
    writeFileSync(path.join(cwd, 'lighthouserc.gpu.json'), JSON.stringify(c));
    return cwd;
  };
  const run = async (argv: string[], env: Record<string, string>, cwd: string) => {
    const lines: string[] = [];
    const code = await main(argv, { env: { NODE_ENV: 'test', ...env }, cwd, log: (l) => lines.push(l) });
    return { code, out: lines.join('\n') };
  };

  it('exits 2 when misconfigured: no CHROME_PATH, the SwiftShader pages config, no config module, an unknown option', async () => {
    const cwd = workdir();
    const unset = await run(['lighthouserc.gpu.json'], {}, cwd);
    expect(unset.code).toBe(2);
    expect(unset.out).toContain('::error title=GPU check misconfigured::lighthouserc.gpu.json: CHROME_PATH must name the Chromium binary');
    const pagesCfg = await run([path.join(root, 'lighthouserc.json')], { CHROME_PATH: '/bin/false' }, cwd);
    expect(pagesCfg.code).toBe(2);
    expect(pagesCfg.out).toContain('--use-angle=swiftshader selects software GL');
    expect(pagesCfg.out).toContain('configPath must name tools/lighthouse/gpu-config.mjs');
    expect((await run(['--verify', 'lighthouserc.gpu.json'], { CHROME_PATH: '/bin/false' }, cwd)).code).toBe(2);
    expect(existsSync(path.join(cwd, EVIDENCE_FILE))).toBe(false);
  });

  it('exits 1 and records the failure when the browser cannot start', async () => {
    const cwd = workdir();
    const r = await run(['lighthouserc.gpu.json'], { CHROME_PATH: '/bin/false' }, cwd);
    expect(r.code).toBe(1);
    const e = JSON.parse(readFileSync(path.join(cwd, EVIDENCE_FILE), 'utf8')) as Evidence;
    expect(e.ok).toBe(false);
    expect(e.chromePath).toBe('/bin/false');
    expect(e.failures[0]).toMatch(/^check aborted: /);
    expect(r.out).toMatch(/^::error title=Lighthouse on \/ not measured on a hardware GPU::check aborted/m);
  }, 30_000);

  it('--verify-runs exits 1 without a passing pre-check, without the runs, and when the browser cannot start afterwards', async () => {
    const cwd = workdir();
    const r = await run(['--verify-runs', 'lighthouserc.gpu.json'], { CHROME_PATH: '/bin/false' }, cwd);
    expect(r.code).toBe(1);
    const e = JSON.parse(readFileSync(path.join(cwd, RUNS_EVIDENCE_FILE), 'utf8')) as RunsEvidence;
    expect(e.ok).toBe(false);
    expect(e.failures).toEqual([
      `${EVIDENCE_FILE} is missing or unreadable: run the pre-check (pnpm lhci:gpu:check) before collecting`,
      'expected 3 Lighthouse runs (3 x 1 URL), found 0 lhr-*.json',
      'http://127.0.0.1:3200/: 0 runs, expected 3',
      expect.stringMatching(/^verification aborted: /),
    ]);
    // A pre-check record for another binary does not count either.
    writeFileSync(path.join(cwd, EVIDENCE_FILE), JSON.stringify({ ok: true, chromePath: '/other/chrome', chromiumVersion: '153.0.8010.12' }));
    const other = await run(['--verify-runs', 'lighthouserc.gpu.json'], { CHROME_PATH: '/bin/false' }, cwd);
    expect(other.code).toBe(1);
    expect(other.out).toContain('checked /other/chrome, not CHROME_PATH /bin/false');
  }, 30_000);

  it('--verify-runs passes three hardware runs after a passing pre-check, and fails when the GPU is gone after the runs', async () => {
    const cwd = workdir();
    mkdirSync(path.join(cwd, '.lighthouseci'));
    writeFileSync(path.join(cwd, EVIDENCE_FILE), JSON.stringify({ ok: true, chromePath: '/bin/false', chromiumVersion: '153.0.8010.12' }));
    for (const t of ['1790840812944', '1790840844147', '1790840871151']) writeFileSync(path.join(cwd, `.lighthouseci/lhr-${t}.json`), JSON.stringify(hardwareRun()));
    const gpuFlags = splitFlags((JSON.parse(read('lighthouserc.gpu.json')) as LhciConfig).ci.collect.settings.chromeFlags);
    const t4 = { renderer: T4_RENDERER, vendor: 'Google Inc. (NVIDIA)', version: 'WebGL 2.0 (OpenGL ES 3.0 Chromium)' };
    const report = (o: Partial<BrowserReport>): BrowserReport => ({
      version: '153.0.8010.12',
      gpu: { devices: [], featureStatus: FS_153_HARDWARE },
      flags: gpuFlags,
      commandLine: RECORDED_COMMAND_LINE,
      featureStatus: FS_153_HARDWARE,
      blank: t4,
      refusing: t4,
      ...o,
    });
    const summary = path.join(cwd, 'summary.md');
    const verify = (r: BrowserReport) => main(['--verify-runs', 'lighthouserc.gpu.json'], { env: { NODE_ENV: 'test', CHROME_PATH: '/bin/false', GITHUB_STEP_SUMMARY: summary }, cwd, log: () => {}, observe: async () => r });
    expect(await verify(report({}))).toBe(0);
    const ok = JSON.parse(readFileSync(path.join(cwd, RUNS_EVIDENCE_FILE), 'utf8')) as RunsEvidence;
    expect([ok.ok, ok.runs.length, ok.failures]).toEqual([true, 3, []]);
    expect(readFileSync(summary, 'utf8')).toContain(`| lhr-1790840812944.json | http://127.0.0.1:3200/ | ${T4_RENDERER} |`);
    // Recorded no-GPU state of Chrome 153: the device was lost between the runs and the verification.
    expect(await verify(report({ featureStatus: FEATURE_STATUS.cft153GpuFlags, blank: null, refusing: null }))).toBe(1);
    const gone = JSON.parse(readFileSync(path.join(cwd, RUNS_EVIDENCE_FILE), 'utf8')) as RunsEvidence;
    expect(gone.failures).toEqual([
      'after the runs: blank canvas: WebGL2 renderer is unavailable (no WebGL2 context)',
      'after the runs: Chromium reports WebGL as "disabled_off", not hardware-enabled',
    ]);
  });

  it('runs main() when reached through a symlink (the old entry guard exited 0 silently)', () => {
    const dir = tmpDir('godseye-symlink-');
    const link = path.join(dir, 'check.ts');
    symlinkSync(tool, link);
    const cwd = workdir();
    const r = spawnSync(process.execPath, ['--experimental-transform-types', '--disable-warning=ExperimentalWarning', link, 'lighthouserc.gpu.json'], {
      cwd,
      env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('::error title=GPU check misconfigured::');
  }, 30_000);
});

describe('README.md', () => {
  const readme = read('README.md');
  it('documents every optional variable in .env.example and every capability', () => {
    const vars = [...read('.env.example').matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]!);
    expect(vars.length).toBeGreaterThan(40);
    for (const v of vars) expect(readme, v).toContain(`\`${v}`);
    for (const id of Object.keys(CAPABILITIES)) expect(readme, id).toContain(`\`${id}\``);
  });
  it('credits OSIRIS under MIT and tells operators to overwrite X-Forwarded-For', () => {
    expect(readme).toContain('OSIRIS © 2026 simplifaisoul, MIT licence');
    expect(readme).toContain('header_up X-Forwarded-For {remote_host}');
    expect(readme).toContain('pnpm i');
  });
  it('tells the owner how to provide the GPU runner for Lighthouse on /, what it costs and how to keep forks off it', () => {
    for (const s of [
      '### GPU runner for Lighthouse on `/`',
      'LIGHTHOUSE_GPU_RUNNER',
      'NVIDIA GPU-Optimized Image for AI and HPC',
      'NVIDIA GPU-Optimized VMI',
      '176 GB SSD',
      'linux_4_core_gpu',
      'Stop usage',
      'should almost never be used for public repositories',
      'generate-jitconfig',
      './run.sh --jitconfig',
      'Administration',
      'ACTIONS_RUNNER_HOOK_JOB_STARTED',
      'Require approval for all external contributors',
      'Build + Lighthouse CI (/, GPU runner)',
      IN_RUN_AUDIT,
      'pnpm lhci:gpu',
      "require('@playwright/test').chromium.executablePath()",
    ]) {
      expect(readme, s).toContain(s);
    }
    // A runner registered once with --ephemeral takes one job and is gone; the README must not suggest it.
    expect(readme).not.toContain('--ephemeral');
    expect(readme).not.toContain('CHROME_PATH=/path/to/chrome');
    // The required-check names in the README are the job names in the workflow.
    const wf = loadYaml(WORKFLOW_TEXT) as Workflow;
    for (const id of ['lighthouse-pages', 'lighthouse-gpu']) expect(readme).toContain(`"${wf.jobs[id]!.name}"`);
  });

  describe('pre-job hook for a self-hosted GPU runner', () => {
    const hook = /```sh\n(#!\/bin\/sh\n# GODSEYE GPU runner pre-job hook[\s\S]*?)```/.exec(readme)?.[1] ?? '';
    const dir = mkdtempSync(path.join(os.tmpdir(), 'godseye-hook-'));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));
    let n = 0;
    const run = (event: string, payload: unknown) => {
      const file = path.join(dir, `event-${(n += 1)}.json`);
      writeFileSync(file, JSON.stringify(payload));
      const env = { NODE_ENV: 'test' as const, PATH: process.env.PATH ?? '', GITHUB_EVENT_NAME: event, GITHUB_EVENT_PATH: file, GITHUB_REPOSITORY: REPO };
      return spawnSync('sh', ['-c', hook], { env, encoding: 'utf8' }).status;
    };
    const hasJq = spawnSync('jq', ['--version']).status === 0;
    const sameRepo = { pull_request: { head: { repo: { full_name: REPO } } } };

    it('is in the README', () => expect(hook).toContain('set -eu'));
    it('admits pushes', () => expect(run('push', {})).toBe(0));
    it.skipIf(!hasJq)('admits pull requests from this repository', () => expect(run('pull_request', sameRepo)).toBe(0));
    it('refuses fork pull requests, deleted head repositories and every other event (fails closed without jq)', () => {
      expect(run('pull_request', { pull_request: { head: { repo: { full_name: 'someone/godseye' } } } })).not.toBe(0);
      expect(run('pull_request', { pull_request: { head: { repo: null } } })).not.toBe(0);
      expect(run('pull_request_target', sameRepo)).not.toBe(0);
      expect(run('workflow_dispatch', {})).not.toBe(0);
      expect(run('', {})).not.toBe(0);
    });
  });

  it('the just-in-time runner call is valid shell, runs on the controller host and registers the labels CI routes to', () => {
    const call = /```sh\n(# On the controller host \(never inside a runner VM\)[\s\S]*?)```/.exec(readme)?.[1] ?? '';
    expect(call).toContain('https://api.github.com/repos/awne8886/godseye/actions/runners/generate-jitconfig');
    expect(call).toContain('\\"labels\\":[\\"self-hosted\\",\\"linux\\",\\"x64\\",\\"godseye-gpu\\"]');
    expect(call).toContain('jq -r .encoded_jit_config');
    expect(spawnSync('sh', ['-n', '-c', call]).status).toBe(0);
    // The label array in the README's variable example is the one the JIT runner carries.
    expect(readme).toContain('`["self-hosted","linux","x64","godseye-gpu"]`');
  });
});
