import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { API_CATALOG, EXCLUDED_OSIRIS_ROUTES, type ApiEndpoint } from '@/lib/api-catalog';
import { CAPABILITIES } from '@/lib/capabilities';
import { DEFAULT_LIMIT } from '@/lib/ratelimit';
import { API_MD_PATH, cellText, currentInput, githubSlug, renderApiMarkdown } from './gen-api-docs';

const CATALOG = API_CATALOG as readonly ApiEndpoint[];
const md = renderApiMarkdown(currentInput());

/** The Markdown section of one endpoint (heading to the next heading). */
function section(e: ApiEndpoint): string {
  const start = md.indexOf(`### \`${e.method} ${e.path}\``);
  expect(start, `${e.method} ${e.path}`).toBeGreaterThanOrEqual(0);
  const next = md.slice(start + 4).search(/\n#{2,3} /);
  return next < 0 ? md.slice(start) : md.slice(start, start + 4 + next);
}

describe('gen-api-docs', () => {
  it('renders every catalogue entry exactly once, with its summary and cache/rate-limit rows', () => {
    for (const e of CATALOG) {
      expect(md.split(`### \`${e.method} ${e.path}\``).length - 1, e.path).toBe(1);
      const s = section(e);
      expect(s).toContain(e.summary);
      expect(s).toMatch(/\| Cache \| /);
      expect(s).toMatch(/\| Rate limit \| /);
      expect(s).toContain(`\`${e.responseSchema}\``);
      for (const u of e.upstreams) expect(s, `${e.path} ${u}`).toContain(`\`${u}\``);
      if (e.capability) expect(s).toContain(`\`${e.capability}\``);
      for (const a of e.aliases ?? []) expect(s).toContain(`\`${a}\``);
    }
  });

  it('renders every parameter in its endpoint table', () => {
    for (const e of CATALOG) {
      const s = section(e);
      if (!e.params.length) expect(s).toContain('No parameters.');
      for (const p of e.params) expect(s, `${e.path} ${p.name}`).toMatch(new RegExp(`\\| \`${p.name}\` \\| ${p.in} \\| `));
    }
  });

  it('uses the real default rate limit for endpoints without their own', () => {
    const health = section(CATALOG.find((e) => e.path === '/api/health')!);
    expect(health).toContain(`${DEFAULT_LIMIT.limit} requests per`);
  });

  it('lists every excluded OSIRIS route with its reason, and every capability', () => {
    for (const r of EXCLUDED_OSIRIS_ROUTES) expect(md).toContain(`| \`${r.path}\` | ${cellText(r.reason)} |`);
    for (const id of Object.keys(CAPABILITIES)) expect(md).toContain(`| \`${id}\` |`);
  });

  it('keeps table rows well-formed (escaped pipes)', () => {
    expect(cellText('a | b\nc')).toBe('a \\| b c');
    const via = md.split('\n').find((l) => l.startsWith('| `via` |'))!;
    expect(via).toContain('lat,lng\\|lat,lng');
  });

  it('builds contents links with GitHub heading slugs', () => {
    expect(githubSlug('Network & cyber')).toBe('network--cyber');
    expect(githubSlug('Flight paths')).toBe('flight-paths');
    expect(md).toContain('- [AI analyst](#ai-analyst)');
  });

  it('is deterministic and docs/API.md is up to date', () => {
    expect(renderApiMarkdown(currentInput())).toBe(md);
    const onDisk = readFileSync(API_MD_PATH, 'utf8');
    expect(onDisk === md, 'docs/API.md is stale: node --experimental-transform-types --import ./tools/ts-loader.mjs tools/gen-api-docs.ts').toBe(true);
  });
});
