import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM tool without types
import { mountedRoutes, render } from './gen-mounted-routes.mjs';
import { API_CATALOG, type ApiEndpoint } from '@/lib/api-catalog';

describe('mounted routes', () => {
  it('src/server/mounted-routes.ts is up to date (run `node tools/gen-mounted-routes.mjs`)', () => {
    const committed = readFileSync(new URL('../src/server/mounted-routes.ts', import.meta.url), 'utf8');
    expect(committed.replace(/,\n\]/, '\n]')).toBe(render(mountedRoutes() as string[]).replace(/,\n\]/, '\n]'));
  });
  it('every mounted route is catalogued (path or alias)', () => {
    const known = new Set((API_CATALOG as readonly ApiEndpoint[]).flatMap((e) => [e.path, ...(e.aliases ?? [])]));
    for (const r of mountedRoutes() as string[]) expect(known.has(r), r).toBe(true);
  });
});
