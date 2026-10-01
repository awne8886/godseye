/**
 * Guards for the operations files owned by pages-docs-privacy-ops: the CI workflow and compose file
 * parse as YAML and keep their gates; the Dockerfile builds with `pnpm build`, runs as non-root and
 * bakes in no secrets; Caddy overwrites X-Forwarded-For; Lighthouse CI keeps the contract thresholds;
 * the README documents every optional variable and capability.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CAPABILITIES } from '@/lib/capabilities';

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

type Step = { uses?: string; run?: string; with?: Record<string, unknown>; if?: string };
type Job = { 'runs-on': string; steps: Step[]; container?: { image: string; options?: string } };
type Workflow = { on: Record<string, unknown>; permissions: Record<string, string>; env: Record<string, string>; jobs: Record<string, Job> };

describe('.github/workflows/ci.yml', () => {
  const wf = loadYaml(read('.github/workflows/ci.yml')) as Workflow;
  const steps = Object.values(wf.jobs).flatMap((j) => j.steps);
  const runs = steps.map((s) => s.run ?? '');

  it('runs on every push and pull request with read-only permissions', () => {
    expect(Object.keys(wf.on).sort()).toEqual(['pull_request', 'push']);
    expect(wf.permissions).toEqual({ contents: 'read' });
  });

  it('runs every quality gate', () => {
    for (const cmd of ['pnpm install --frozen-lockfile', 'pnpm lint', 'pnpm typecheck', 'pnpm test:coverage', 'pnpm build', 'pnpm lhci', 'pnpm audit --prod --audit-level high']) {
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

describe('lighthouserc.json', () => {
  const lhci = JSON.parse(read('lighthouserc.json')) as {
    ci: { collect: { url: string[]; settings: { pauseAfterLoadMs: number } }; assert: { assertions: Record<string, [string, Record<string, number>]> }; upload: { target: string } };
  };
  it('asserts the contract thresholds on the map, /docs and /privacy', () => {
    const a = lhci.ci.assert.assertions;
    expect(a['categories:performance']![1].minScore).toBe(0.85);
    expect(a['categories:accessibility']![1].minScore).toBe(1);
    expect(a['largest-contentful-paint']![1].maxNumericValue).toBe(2500);
    expect(a['cumulative-layout-shift']![1].maxNumericValue).toBe(0.1);
    expect(a['total-blocking-time']![1].maxNumericValue).toBe(300);
    for (const [, [level]] of Object.entries(a)) expect(level).toBe('error');
    expect(lhci.ci.collect.url.map((u) => new URL(u).pathname)).toEqual(['/', '/docs', '/privacy']);
    expect(lhci.ci.collect.settings.pauseAfterLoadMs).toBeGreaterThanOrEqual(8000);
    expect(lhci.ci.upload.target).toBe('filesystem');
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
});
