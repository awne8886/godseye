/**
 * Lazy-load guard: the space module entry (bundled into `/` through the feature registry) and the
 * main-thread layer/card/panel must never statically reach satellite.js. SGP4 runs only in the
 * tle-propagate worker and on the server. Walks static (non-type) imports from source.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');
const STATIC_IMPORT = /^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;

function resolve(spec: string, from: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = path.join(ROOT, 'src', spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec);
  else return null; // package
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (existsSync(c) && !c.endsWith(path.sep) && /\.(ts|tsx)$/.test(c)) return c;
  }
  return null;
}

/** Every file + package reachable from `entry` through static value imports. */
function staticGraph(entry: string): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop()!;
    if (files.has(f)) continue;
    files.add(f);
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(STATIC_IMPORT)) {
      const spec = m[1]!;
      const r = resolve(spec, f);
      if (r) stack.push(r);
      else if (!spec.startsWith('.') && !spec.startsWith('@/')) packages.add(spec);
    }
  }
  return { files, packages };
}

const space = (p: string) => path.join(ROOT, 'src/features/space', p);

describe('space module lazy loading', () => {
  it('the entry file only reaches the layer, cards and panels through next/dynamic', () => {
    const { files, packages } = staticGraph(space('index.ts'));
    expect([...packages]).not.toContain('satellite.js');
    for (const f of files) expect(f).not.toMatch(/SatelliteLayer|SatelliteCard|SpacePanel|propagat|orbit\.ts$/);
  });

  it.each(['SatelliteLayer.tsx', 'SatelliteCard.tsx', 'SpacePanel.tsx'])('%s (main thread) never statically imports satellite.js', (file) => {
    const { packages, files } = staticGraph(space(file));
    expect([...packages]).not.toContain('satellite.js');
    expect([...files].some((f) => f.endsWith(`${path.sep}orbit.ts`) || f.endsWith('propagate-batch.ts'))).toBe(false);
  });

  it('the worker is where satellite.js is loaded', () => {
    const { packages } = staticGraph(path.join(ROOT, 'src/workers/tle-propagate.ts'));
    expect([...packages]).toContain('satellite.js');
  });
});

// perf round 5 m-k: field-name constants came from the zod contract, so zod (88.6 KB gz) was
// downloaded on `/` and inside the worker. They now live in the zod-free `src/lib/schemas/space-fields.ts`.
describe('space client code never loads zod', () => {
  const schemas = path.join(ROOT, 'src/lib/schemas') + path.sep;
  const fieldsFile = path.join(ROOT, 'src/lib/schemas/space-fields.ts');
  // The zod-free field list is the one schema-directory module client code may reach.
  const zodSchemas = (files: Iterable<string>) => [...files].filter((f) => f.startsWith(schemas) && f !== fieldsFile);

  it('space-fields.ts is a leaf module (imports nothing, so never zod)', () => {
    const { packages, files } = staticGraph(fieldsFile);
    expect([...packages]).toEqual([]);
    expect([...files].filter((f) => f !== fieldsFile)).toEqual([]);
  });

  it('the tle-propagate worker reaches neither zod nor a schema module', () => {
    const { packages, files } = staticGraph(path.join(ROOT, 'src/workers/tle-propagate.ts'));
    expect([...packages]).not.toContain('zod');
    expect(zodSchemas(files)).toEqual([]);
  });

  it.each(['index.ts', 'SatelliteLayer.tsx', 'SatelliteCard.tsx', 'SpacePanel.tsx', 'client/data.ts', 'client/pick.ts', 'lib/catalog.ts', 'lib/packed.ts'])(
    '%s reaches no schema module (zod stays off the main thread)',
    (file) => {
      const { packages, files } = staticGraph(space(file));
      expect(zodSchemas(files)).toEqual([]);
      expect([...packages]).not.toContain('zod');
    },
  );

  it('the contract re-exports the same field list', async () => {
    const [{ SATELLITE_FIELDS: contract }, { SATELLITE_FIELDS: plain }] = await Promise.all([import('@/lib/schemas/space'), import('@/lib/schemas/space-fields')]);
    expect(contract).toBe(plain);
  });
});
