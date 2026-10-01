/**
 * Guards for the operations files owned by pages-docs-privacy-ops: the CI workflow and compose file
 * parse as YAML and keep their gates; the Dockerfile builds with `pnpm build`, runs as non-root and
 * bakes in no secrets; Caddy overwrites X-Forwarded-For; Lighthouse CI keeps the contract thresholds,
 * with `/` measured only on a GPU runner after the hardware-WebGL2 check; the README documents every
 * optional variable and capability and the GPU runner set-up.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CAPABILITIES } from '@/lib/capabilities';
import {
  classifyRenderer,
  commandLineProblems,
  featureStatusProblem,
  flagProblems,
  PLAYWRIGHT_DEFAULTS_DROPPED,
  readGpuConfig,
  splitFlags,
  summaryMarkdown,
  workflowCommandData,
  type Evidence,
} from './gpu-renderer-check';

const root = path.resolve(import.meta.dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');

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
const LHCI_GPU = 'pnpm exec lhci autorun --config=./lighthouserc.gpu.json';

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
      LHCI_GPU,
      'pnpm audit --prod --audit-level high',
    ]) {
      expect(runs, cmd).toContain(cmd);
    }
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

  it('fails fast with an ::error naming the setting, before anything else runs', () => {
    const first = job.steps[0]!;
    expect(first.uses).toBeUndefined();
    expect(first.if).toBeUndefined();
    const sh = (env: Record<string, string>) =>
      spawnSync('sh', ['-e', '-c', first.run ?? ''], { env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '', RUNNER_NAME: 'test-runner', ...env }, encoding: 'utf8' });
    const unset = sh({ GPU_RUNNER: '', TRUSTED_SOURCE: 'true' });
    expect(unset.status).toBe(1);
    expect(unset.stdout).toMatch(/^::error title=[^:]+::The repository variable LIGHTHOUSE_GPU_RUNNER is empty.*Settings > Secrets and variables > Actions > Variables/m);
    const fork = sh({ GPU_RUNNER: 'gpu-t4-4core', TRUSTED_SOURCE: 'false' });
    expect(fork.status).toBe(1);
    expect(fork.stdout).toMatch(/^::error title=[^:]+::Pull requests from forks never run on the GPU runner/m);
    expect(sh({ GPU_RUNNER: 'gpu-t4-4core', TRUSTED_SOURCE: 'true' }).status).toBe(0);
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

  it('builds, proves hardware WebGL2 with the same Chromium, then runs Lighthouse on the GPU config', () => {
    const checkout = idx((s) => s.uses?.startsWith('actions/checkout@') ?? false);
    const chromePath = idx((s) => /CHROME_PATH=.*chromium\.executablePath\(\).*>> "\$GITHUB_ENV"/.test(s.run ?? ''));
    const build = idx((s) => s.run === 'pnpm build');
    const check = idx((s) => s.run === 'pnpm lhci:gpu:check');
    const lhci = idx((s) => s.run === LHCI_GPU);
    const upload = idx((s) => s.uses?.startsWith('actions/upload-artifact@') ?? false);
    expect(checkout).toBeGreaterThan(0);
    expect(chromePath).toBeGreaterThan(checkout);
    expect(build).toBeGreaterThan(chromePath);
    expect(check).toBeGreaterThan(build);
    expect(lhci).toBe(check + 1);
    expect(upload).toBeGreaterThan(lhci);
    // The gate and the measurement run only when every earlier step succeeded.
    expect(job.steps[check]!.if).toBeUndefined();
    expect(job.steps[lhci]!.if).toBeUndefined();
    expect(job.steps[upload]!.if).toBe('always()');
    expect(job.steps[upload]!.with).toMatchObject({ name: 'lighthouse-gpu', path: '.lighthouseci/' });
    // No software GL in this job; root (apt) only on GitHub-hosted runners.
    expect(job.steps.map((s) => s.run ?? '').join('\n')).not.toMatch(/swiftshader|xvfb/i);
    for (const s of job.steps.filter((st) => /\bsudo\b|--with-deps/.test(st.run ?? ''))) expect(s.if).toBe("runner.environment == 'github-hosted'");
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
    for (const entry of ['.env', '.env.*', '.git', 'node_modules', '.next']) expect(ignore).toContain(entry);
  });
});

type LhciConfig = {
  ci: {
    collect: {
      startServerCommand: string;
      startServerReadyPattern: string;
      startServerReadyTimeout: number;
      url: string[];
      numberOfRuns: number;
      settings: { preset: string; pauseAfterLoadMs: number; chromeFlags: string };
    };
    assert: { assertions: Record<string, [string, Record<string, number | string>]> };
    upload: { target: string; outputDir: string };
  };
};

describe('Lighthouse configs', () => {
  const pages = JSON.parse(read('lighthouserc.json')) as LhciConfig;
  const gpu = JSON.parse(read('lighthouserc.gpu.json')) as LhciConfig;
  const paths = (c: LhciConfig) => c.ci.collect.url.map((u) => new URL(u).pathname);

  it.each([
    ['lighthouserc.json', pages],
    ['lighthouserc.gpu.json', gpu],
  ] as const)('%s asserts the contract thresholds as errors on the median of three desktop runs', (_, c) => {
    const a = c.ci.assert.assertions;
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
    expect(c.ci.collect.settings.preset).toBe('desktop');
    expect(c.ci.collect.settings.pauseAfterLoadMs).toBeGreaterThanOrEqual(8000);
    expect(c.ci.upload).toEqual({ target: 'filesystem', outputDir: '.lighthouseci' });
    const port = /--port (\d+)/.exec(c.ci.collect.startServerCommand)?.[1];
    for (const u of c.ci.collect.url) expect(new URL(u).port).toBe(port);
  });

  it('share assertions, server and run settings; only the URLs and Chrome flags differ', () => {
    expect(gpu.ci.assert).toEqual(pages.ci.assert);
    expect(gpu.ci.upload).toEqual(pages.ci.upload);
    const rest = (c: LhciConfig) => ({ ...c.ci.collect, url: [], settings: { ...c.ci.collect.settings, chromeFlags: '' } });
    expect(rest(gpu)).toEqual(rest(pages));
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
    expect(readGpuConfig(path.join(root, 'lighthouserc.gpu.json'))).toEqual({
      urls: gpu.ci.collect.url,
      flags,
      server: { command: 'pnpm start --port 3200', readyPattern: 'Ready', timeoutMs: 90_000 },
    });
  });

  it('package.json: `pnpm lhci` measures the pages config; `pnpm lhci:gpu` runs the renderer check first', () => {
    const { scripts } = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(scripts.lhci).toBe('lhci autorun --config=./lighthouserc.json');
    expect(scripts['lhci:gpu:check']).toBe('node --experimental-transform-types --disable-warning=ExperimentalWarning tools/gpu-renderer-check.ts lighthouserc.gpu.json');
    expect(scripts['lhci:gpu']).toBe('pnpm lhci:gpu:check && lhci autorun --config=./lighthouserc.gpu.json');
  });
});

/** Recorded 2026-10-01 in the build sandbox (Chromium 141.0.7390.37, no GPU). */
const SWIFTSHADER_RENDERER = 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)';
/** `SystemInfo.getInfo().commandLine` recorded by tools/gpu-renderer-check.ts in the same run. */
const RECORDED_COMMAND_LINE = [
  '/opt/pw-browsers/chromium --disable-background-networking --disable-background-timer-throttling',
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
  '--disable-vulkan-surface --user-data-dir=/tmp/playwright_chromiumdev_profile-2Y8fPp --remote-debugging-pipe',
  '--no-startup-window --noerrdialogs --ozone-platform=headless --ozone-override-screen-size=800,600',
  '--flag-switches-begin --flag-switches-end',
].join(' ');

describe('tools/gpu-renderer-check.ts', () => {
  const gpuFlags = splitFlags((JSON.parse(read('lighthouserc.gpu.json')) as LhciConfig).ci.collect.settings.chromeFlags);
  const probe = (renderer: string | null, vendor: string | null = null) => ({ renderer, vendor, version: 'WebGL 2.0 (OpenGL ES 3.0 Chromium)' });

  it('classifies software rasterisers as software, whatever the GPU flags say', () => {
    expect(classifyRenderer(probe(SWIFTSHADER_RENDERER, 'Google Inc. (Google)'))).toBe('software');
    // Shapes of Mesa and Windows software renderer strings (no such renderer in the sandbox).
    expect(classifyRenderer(probe('ANGLE (Mesa, llvmpipe (LLVM 15.0.7, 256 bits), OpenGL 4.5)'))).toBe('software');
    expect(classifyRenderer(probe('ANGLE (Mesa, Vulkan 1.3.255 (llvmpipe (LLVM 15.0.7, 256 bits)), lavapipe)'))).toBe('software');
    expect(classifyRenderer(probe('ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11)'))).toBe('software');
    expect(classifyRenderer(probe('Some GPU', 'Google SwiftShader'))).toBe('software');
  });

  it('accepts hardware renderers, and fails closed on masked, empty or missing contexts', () => {
    // Shapes of ANGLE hardware renderer strings (the sandbox has no GPU; Tesla T4 is PCI 10de:1eb8).
    expect(classifyRenderer(probe('ANGLE (NVIDIA, Vulkan 1.3.277 (NVIDIA Tesla T4 (0x00001EB8)), NVIDIA)', 'Google Inc. (NVIDIA)'))).toBe('hardware');
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
    expect(PLAYWRIGHT_DEFAULTS_DROPPED).toEqual(expect.arrayContaining(['--enable-unsafe-swiftshader', '--disable-field-trial-config']));
    expect(commandLineProblems(RECORDED_COMMAND_LINE, gpuFlags)).toEqual([]);
    expect(commandLineProblems(`${RECORDED_COMMAND_LINE} --enable-unsafe-swiftshader`, gpuFlags)).toEqual(['Chromium was launched with --enable-unsafe-swiftshader']);
    expect(commandLineProblems(`${RECORDED_COMMAND_LINE} --disable-field-trial-config`, gpuFlags)).toEqual(['Chromium was launched with --disable-field-trial-config']);
    expect(commandLineProblems(RECORDED_COMMAND_LINE.replace(' --use-angle=vulkan', ''), gpuFlags)).toEqual(['Chromium was not launched with --use-angle=vulkan']);
  });

  it("requires Chromium's own WebGL2 status to be enabled without software", () => {
    expect(featureStatusProblem('enabled')).toBeNull();
    // Recorded in the sandbox with the GPU flags and no GPU: as Lighthouse launches Chromium, and with
    // Playwright's --disable-field-trial-config (which hands out SwiftShader WebGL2 instead).
    expect(featureStatusProblem('disabled_off')).toMatch(/not hardware-enabled/);
    expect(featureStatusProblem('unavailable_software')).toMatch(/not hardware-enabled/);
    expect(featureStatusProblem(undefined)).toMatch(/missing/);
  });

  it('reports to the job summary and workflow commands without breaking their syntax', () => {
    const evidence: Evidence = {
      checkedAt: '2026-10-01T06:44:12.959Z',
      config: 'lighthouserc.gpu.json',
      chromePath: '/opt/pw-browsers/chromium',
      chromiumVersion: '141.0.7390.37',
      flags: gpuFlags,
      commandLine: RECORDED_COMMAND_LINE,
      gpu: null,
      blank: { probe: probe('a | b'), verdict: 'hardware', refusingCaveatContext: true, webgl2Status: 'enabled' },
      pages: [{ url: 'http://127.0.0.1:3200/', probe: probe(SWIFTSHADER_RENDERER), verdict: 'software', problem: 'x' }],
      failures: ['x'],
      ok: false,
    };
    const md = summaryMarkdown(evidence);
    expect(md).toContain('NOT measured on a hardware GPU');
    expect(md).toContain('| blank canvas | a \\| b |');
    expect(md).toContain(`| http://127.0.0.1:3200/ (MapLibre canvas) | ${SWIFTSHADER_RENDERER} |`);
    expect(summaryMarkdown({ ...evidence, ok: true, failures: [] })).toContain('WebGL2 renderer check: hardware GPU');
    expect(workflowCommandData('50%\r\nnext')).toBe('50%25%0D%0Anext');
  });
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
      'linux_4_core_gpu',
      'should almost never be used for public repositories',
      '--ephemeral',
      'ACTIONS_RUNNER_HOOK_JOB_STARTED',
      'Require approval for all external contributors',
      'Build + Lighthouse CI (/, GPU runner)',
      'pnpm lhci:gpu',
    ]) {
      expect(readme, s).toContain(s);
    }
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
});
