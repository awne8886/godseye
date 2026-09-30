import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CAPABILITIES, type CapabilitySpec } from './capabilities';

const example = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
const documented = new Set([...example.matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]));

describe('.env.example', () => {
  it('documents every capability variable and requires none', () => {
    for (const spec of Object.values(CAPABILITIES) as CapabilitySpec[]) {
      for (const v of [...spec.env, spec.flag, spec.invertFlag].filter(Boolean) as string[]) expect(documented.has(v), v).toBe(true);
    }
    for (const line of example.split('\n').filter((l) => /^[A-Z0-9_]+=/.test(l))) expect(line.endsWith('='), line).toBe(true);
  });
  it('contains no NEXT_PUBLIC_ secrets', () => {
    expect(example).not.toMatch(/^NEXT_PUBLIC_/m);
  });
});
