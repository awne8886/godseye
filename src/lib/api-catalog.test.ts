import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { API_CATALOG, EXCLUDED_OSIRIS_ROUTES, routeFileFor, upstreamsReceivingUserInput, type ApiEndpoint } from './api-catalog';
import { CAPABILITIES } from './capabilities';
import * as S from './schemas';

const catalog = API_CATALOG as readonly ApiEndpoint[];
const root = path.resolve(__dirname, '../..');

function routeFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return routeFiles(p);
    return name === 'route.ts' ? [path.relative(root, p)] : [];
  });
}

describe('api catalogue', () => {
  it('has unique method+path pairs under /api', () => {
    const keys = catalog.map((e) => `${e.method} ${e.path}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const e of catalog) expect(e.path.startsWith('/api/')).toBe(true);
  });

  it('points every endpoint at a real response schema', () => {
    for (const e of catalog) {
      if (e.responseSchema === 'image/*') continue;
      expect(S, `${e.path} → ${e.responseSchema}`).toHaveProperty(e.responseSchema);
    }
  });

  it('declares TTLs for GET JSON and none for streams/POST', () => {
    for (const e of catalog) {
      if (e.stream || e.method === 'POST') expect(e.ttlSeconds, e.path).toBeNull();
      else if (e.path !== '/api/geo' && e.path !== '/api/scanner') expect(e.ttlSeconds, e.path).toBeGreaterThan(0);
    }
  });

  it('references known capabilities and rate-limits AI at 5/min', () => {
    for (const e of catalog) if (e.capability) expect(CAPABILITIES).toHaveProperty(e.capability);
    for (const e of catalog.filter((x) => x.group === 'ai')) expect(e.rateLimit).toEqual({ limit: 5, windowS: 60, bucket: 'ai', failClosed: true });
  });

  it('keeps misnamed OSIRIS routes as aliases of the renamed ones', () => {
    const aliases = catalog.flatMap((e) => e.aliases ?? []);
    expect(aliases).toContain('/api/gdelt');
    expect(aliases).toContain('/api/radar');
    for (const a of aliases) expect(catalog.some((e) => e.path === a), `${a} must not also be a primary path`).toBe(false);
  });

  it('never re-adds an excluded OSIRIS route', () => {
    for (const x of EXCLUDED_OSIRIS_ROUTES) expect(catalog.some((e) => e.path === x.path)).toBe(false);
  });

  it('lists upstreams that receive user input for the Privacy page', () => {
    const hosts = upstreamsReceivingUserInput();
    expect(hosts).toContain('nominatim.openstreetmap.org');
    expect(hosts).toContain('api.anthropic.com');
  });

  it('maps templated paths to App Router files', () => {
    expect(routeFileFor('/api/airports/{code}')).toBe('src/app/api/airports/[code]/route.ts');
  });

  it('documents every route file that exists (no undocumented routes)', () => {
    const documented = new Set(catalog.flatMap((e) => [routeFileFor(e.path), ...(e.aliases ?? []).map(routeFileFor)]));
    for (const file of routeFiles(path.join(root, 'src/app/api'))) expect(documented.has(file), `${file} is not in the API catalogue`).toBe(true);
  });

  // Enabled once Phase 2 has built every route (see TODO.md): every catalogue entry must have a route file.
  it.runIf(process.env.CHECK_CATALOG_COMPLETENESS === '1')('has a route file for every catalogue entry', () => {
    const missing = catalog.map((e) => routeFileFor(e.path)).filter((f) => !existsSync(path.join(root, f)));
    expect(missing).toEqual([]);
  });
});
