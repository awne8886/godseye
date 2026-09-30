// Lets build tools written in TypeScript import app modules the way the bundler does:
//   node --experimental-transform-types --import ./tools/ts-loader.mjs tools/gen-api-docs.ts
// Node's built-in TypeScript support needs explicit `.ts` extensions; app code uses extensionless
// relative imports and the `@/` alias (tsconfig paths). This resolve hook maps both onto files in
// src/. `--experimental-transform-types` (Node >= 22.7) also handles parameter properties. Modules
// that import CSS, JSON without attributes or `server-only` cannot be loaded this way.
// Owner: pages-docs-privacy-ops.
import { existsSync, statSync } from 'node:fs';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isMainThread } from 'node:worker_threads';

const SRC = new URL('../src/', import.meta.url);
const CANDIDATES = ['', '.ts', '.tsx', '/index.ts'];

function findFile(base) {
  for (const suffix of CANDIDATES) {
    const path = fileURLToPath(base) + suffix;
    if (existsSync(path) && statSync(path).isFile()) return pathToFileURL(path).href;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  let base = null;
  if (specifier.startsWith('@/')) base = new URL(specifier.slice(2), SRC);
  else if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:')) {
    base = new URL(specifier, context.parentURL);
  }
  if (base) {
    const url = findFile(base);
    if (url?.endsWith('.json')) {
      // Bundler-style `import pkg from '../../package.json'` (no `with { type: 'json' }`).
      const importAttributes = { ...context.importAttributes, type: 'json' };
      return { ...(await nextResolve(url, { ...context, importAttributes })), importAttributes };
    }
    if (url) return nextResolve(url, context);
  }
  return nextResolve(specifier, context);
}

// Hooks run on their own thread; register this module once, from the main thread.
if (isMainThread) register(import.meta.url);
