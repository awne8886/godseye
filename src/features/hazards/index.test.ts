/**
 * Bundle guard (perf B1): the hazards entry is in the initial page JS, so its STATIC import graph
 * must not reach zod (schemas), deck.gl, luma.gl or h3-js. Layers and cards load via next/dynamic
 * (`import()` calls are not followed here); `import type` is erased and ignored.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '../..');
const FORBIDDEN = [/^zod($|\/)/, /^@deck\.gl\//, /^@luma\.gl\//, /^h3-js$/, /^@\/lib\/schemas($|\/)/];

function resolveLocal(spec: string, from: string): string | null {
  const base = spec.startsWith('@/') ? join(SRC, spec.slice(2)) : spec.startsWith('.') ? resolve(dirname(from), spec) : null;
  if (!base) return null;
  for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) if (existsSync(base + ext) && !(ext === '' && !/\.tsx?$/.test(base))) return base + ext;
  return null;
}

/** Static, value-level import specifiers of a module (drops `import type` and type-only `export … from`). */
function staticImports(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const m of src.matchAll(/^\s*(import|export)\s+(type\s+)?([^'";]*?)\s*from\s*['"]([^'"]+)['"]/gm)) {
    if (m[2]) continue;
    out.push(m[4]!);
  }
  for (const m of src.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) out.push(m[1]!);
  return out;
}

function reachable(entry: string): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop()!;
    if (files.has(f)) continue;
    files.add(f);
    for (const spec of staticImports(f)) {
      const local = resolveLocal(spec, f);
      if (local) stack.push(local);
      else if (spec.startsWith('@/')) packages.add(spec);
      else if (!spec.startsWith('.')) packages.add(spec);
    }
  }
  return { files, packages };
}

describe('hazards entry bundle guard', () => {
  const { files, packages } = reachable(join(SRC, 'features/hazards/index.ts'));

  it('reaches no zod / deck.gl / luma.gl / h3-js / schemas module statically', () => {
    const bad = [...packages].filter((p) => FORBIDDEN.some((re) => re.test(p)));
    const badFiles = [...files].filter((f) => f.includes(`${join(SRC, 'lib/schemas')}`));
    expect(bad).toEqual([]);
    expect(badFiles).toEqual([]);
  });

  it('does not statically import any client layer or card module', () => {
    expect([...files].filter((f) => f.includes('/features/hazards/client/'))).toEqual([]);
  });

  it('client helpers used by the cards stay zod-free (shared.ts)', () => {
    const shared = reachable(join(SRC, 'features/hazards/shared.ts'));
    expect([...shared.packages].filter((p) => FORBIDDEN.some((re) => re.test(p)))).toEqual([]);
    expect([...shared.files].filter((f) => f.includes('/lib/schemas'))).toEqual([]);
  });
});
