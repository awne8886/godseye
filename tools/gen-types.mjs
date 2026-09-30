// Regenerates src/lib/types.ts from the zod schemas in src/lib/schemas/*.ts.
// Usage: node tools/gen-types.mjs   (run after adding or renaming an exported schema)
import { readFileSync, writeFileSync } from 'node:fs';

const files = ['common', 'aviation', 'space', 'maritime', 'hazards', 'surveillance', 'threats', 'network', 'intel', 'flight-paths', 'system', 'osint'];
// Exports that are helpers or field lists, not schemas.
const skip = new Set(['feedResponse', 'columnarResponse', 'FLIGHT_FIELDS', 'SATELLITE_FIELDS', 'CAMERA_FIELDS']);

let out = `/**
 * Entity and response types, inferred from the zod contracts in ./schemas so the two can
 * never drift. UI-only types (layer ids, tool ids, selection) live in the registries.
 * Regenerate the list below when a schema is added (tools/gen-types.mjs does it).
 */
import type { z } from 'zod';
import type * as S from './schemas';

`;
for (const f of files) {
  const src = readFileSync(new URL(`../src/lib/schemas/${f}.ts`, import.meta.url), 'utf8');
  const names = [...src.matchAll(/^export const (\w+)/gm)].map((m) => m[1]).filter((n) => !skip.has(n));
  out += `// ${f}\n${names.map((n) => `export type ${n} = z.infer<typeof S.${n}>;`).join('\n')}\n\n`;
}
writeFileSync(new URL('../src/lib/types.ts', import.meta.url), out.trimEnd() + '\n');
console.log('gen-types: wrote src/lib/types.ts');
