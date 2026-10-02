import { describe, expect, it } from 'vitest';
import { catalogEntry } from '@/lib/api-catalog';
import { CCTV_REGIONS } from '@/features/surveillance/shared';
// @ts-expect-error plain ESM tool without types
import { CAPABILITY_GATED, ROUTES, cctvRegions, statusProblem } from './payload-sizes.mjs';

const routes = ROUTES as string[];
const gated = CAPABILITY_GATED as Set<string>;
const base = (p: string) => p.split('?')[0]!;

describe('tools/perf/payload-sizes.mjs', () => {
  it('measures every camera region the app knows, japan included', () => {
    expect(cctvRegions()).toEqual([...CCTV_REGIONS]);
    expect(routes).toContain('cctv?region=japan');
    for (const r of CCTV_REGIONS) expect(routes).toContain(`cctv?region=${r}`);
    expect(() => cctvRegions('export const OTHER = [];')).toThrow(/CCTV_REGIONS/);
  });

  it('probes only routes that exist in the catalogue (no bare /api/airports), with every required param', () => {
    expect(routes).not.toContain('airports');
    expect(routes).toEqual(expect.arrayContaining(['airports/search?q=lon', 'route/plan?from=EGLL&to=KJFK']));
    for (const r of routes) {
      const entry = catalogEntry(`/api/${base(r)}`);
      expect(entry, r).toBeDefined();
      const given = new URLSearchParams(r.split('?')[1] ?? '');
      for (const p of entry!.params.filter((x) => x.required && x.in === 'query')) expect(given.has(p.name), `${r} needs ?${p.name}`).toBe(true);
    }
  });

  it('treats 403 as a documented gate only on routes the catalogue gates by capability', () => {
    const expected = routes.map(base).filter((r) => catalogEntry(`/api/${r}`)?.capability !== undefined);
    expect([...gated].sort()).toEqual([...new Set(expected)].sort());
  });

  it('fails a route that was not measured (404, 500, no response), never reporting it within budget', () => {
    expect(statusProblem('flights', 200)).toBeNull();
    expect(statusProblem('flights', 503)).toBeNull();
    expect(statusProblem('frontlines', 403)).toBeNull();
    expect(statusProblem('flights', 403)).toMatch(/unexpected status 403/);
    expect(statusProblem('airports', 404)).toMatch(/unexpected status 404/);
    expect(statusProblem('news', 500)).toMatch(/500/);
    expect(statusProblem('news', 0)).toMatch(/no response/);
  });
});
