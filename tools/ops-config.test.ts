/**
 * Guards for the operations files owned by pages-docs-privacy-ops: the CI workflow and compose file
 * parse as YAML and keep their gates; the Dockerfile builds with `pnpm build`, runs as non-root and
 * bakes in no secrets; Caddy overwrites X-Forwarded-For; Lighthouse CI keeps the contract thresholds;
 * the README documents every optional variable and capability.
 */
import { readFileSync } from 'node:fs';
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
type Job = { 'runs-on': string; steps: Step[] };
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
    for (const cmd of ['pnpm install --frozen-lockfile', 'pnpm lint', 'pnpm typecheck', 'pnpm test:coverage', 'pnpm build', 'pnpm e2e', 'pnpm lhci', 'pnpm audit --prod --audit-level high']) {
      expect(runs, cmd).toContain(cmd);
    }
    expect(runs.some((r) => r.includes('playwright install --with-deps chromium'))).toBe(true);
    // Sandbox-only switches never reach CI.
    expect(read('.github/workflows/ci.yml')).not.toMatch(/E2E_IGNORE_HTTPS_ERRORS|PLAYWRIGHT_CHROMIUM_EXECUTABLE/);
  });

  it('pins every action to a full commit SHA', () => {
    const uses = steps.map((s) => s.uses).filter(Boolean) as string[];
    expect(uses.length).toBeGreaterThan(5);
    for (const u of uses) expect(u, u).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
  });

  it('documents the catalogue completeness switch, currently off', () => {
    expect(wf.env.CHECK_CATALOG_COMPLETENESS).toBe('0');
  });
});

describe('docker-compose.yml, Caddyfile and Dockerfile', () => {
  type Service = { image?: string; build?: unknown; ports?: string[]; expose?: string[]; profiles?: string[]; environment?: Record<string, string> };
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

  it('Caddy overwrites the client-IP headers and streams SSE unbuffered', () => {
    const caddyfile = read('Caddyfile');
    expect(caddyfile).toContain('header_up X-Forwarded-For {remote_host}');
    expect(caddyfile).toContain('header_up X-Real-IP {remote_host}');
    expect(caddyfile).toContain('flush_interval -1');
    expect(caddyfile).not.toMatch(/^\s*log\b/m);
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
