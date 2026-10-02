import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM tool without types
import { attributeModule, budgetReport, libraryLiteralSets, measureChunk, splitTurbopackChunk, stringLiterals } from './bundle-attribution.mjs';

/** Twelve distinctive literals of a pretend map library, as its published dist would hold them. */
const LIB_LITERALS = Array.from({ length: 12 }, (_, i) => `maplibre-only-literal-${i}`);

/** A pnpm store with one excluded library and one other package. */
const root = mkdtempSync(path.join(tmpdir(), 'bundle-attr-'));
function pkg(storeEntry: string, name: string, src: string) {
  const dir = path.join(root, '.pnpm', storeEntry, 'node_modules', name, 'dist');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'index.mjs'), src);
}
pkg('maplibre-gl@6.11.2', 'maplibre-gl', `// it's a comment with a quote\nexport const L = [${LIB_LITERALS.map((s) => `"${s}"`).join(', ')}];`);
pkg('@luma.gl+core@9.4.2', '@luma.gl/core', `export const M = 'luma-only-literal-a';`);
pkg('hls.js@1.6.0', 'hls.js', `export const H = 'not-an-excluded-library';`);
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A production Turbopack chunk shape: push([currentScript, id, factory, id, factory]). */
const libModule = `e=>{"use strict";let t=[${LIB_LITERALS.map((s) => `"${s}"`).join(',')}];e.s(["L",0,t])}`;
const appModule = `e=>{"use strict";var t=e.i(77);e.s(["cameraFromMap",0,function(){return "app-owned-literal-x"}])}`;
const CHUNK = `(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,77180,${libModule},92357,${appModule}]);`;

describe('bundle attribution (initial-JS budget, map libraries excluded)', () => {
  it('extracts literals across quote styles and skips comments', () => {
    const lits = stringLiterals(`// don't count this\nconst a = "first-literal-1", b = 'second-literal', c = \`third-literal\`; /* "comment-literal" */`);
    expect([...lits].sort()).toEqual(['first-literal-1', 'second-literal', 'third-literal']);
  });

  it('builds literal sets per excluded library from the pnpm store only', () => {
    const sets = libraryLiteralSets(root);
    expect(Object.keys(sets)).toEqual(['maplibre-gl', 'deck.gl', 'luma.gl']);
    expect(sets['maplibre-gl'].size).toBe(12);
    expect(sets['luma.gl'].has('luma-only-literal-a')).toBe(true);
    expect(sets['deck.gl'].size).toBe(0);
    expect([...Object.values(sets)].some((s) => (s as Set<string>).has('not-an-excluded-library'))).toBe(false);
  });

  it('splits a Turbopack chunk into its module factories without running them', () => {
    const mods = splitTurbopackChunk(CHUNK);
    expect(mods.map((m: { id: number }) => m.id)).toEqual([77180, 92357]);
    expect(mods[0].source).toBe(libModule);
    expect(splitTurbopackChunk('throw new Error("runtime chunk")')).toBeNull();
    expect(splitTurbopackChunk('var x = 1;')).toBeNull();
  });

  it('attributes only modules with enough library literals (conservative)', () => {
    const sets = libraryLiteralSets(root);
    expect(attributeModule(libModule, sets)).toBe('maplibre-gl');
    expect(attributeModule(appModule, sets)).toBeNull();
    // Two shared literals are not enough evidence: the module stays counted.
    expect(attributeModule(`e=>{"${LIB_LITERALS[0]}";"${LIB_LITERALS[1]}"}`, sets)).toBeNull();
  });

  it('measures a chunk with the library module removed and reports the budget honestly', () => {
    const sets = libraryLiteralSets(root);
    const c = measureChunk('/_next/static/chunks/a.js', CHUNK, sets);
    expect(c.split).toBe(true);
    expect(c.modules).toBe(2);
    expect(c.excludedRaw).toEqual({ 'maplibre-gl': libModule.length });
    expect(c.countedRaw).toBe(CHUNK.length - libModule.length);
    expect(c.countedGzip).toBeLessThan(c.gzip);
    const whole = measureChunk('/_next/static/chunks/turbopack-x.js', 'self.x=1;', sets);
    expect(whole.split).toBe(false);
    expect(whole.countedGzip).toBe(whole.gzip);
    const r = budgetReport([c, whole], 1);
    expect(r.files).toBe(2);
    expect(r.countedGzipBytes).toBe(c.countedGzip + whole.gzip);
    expect(r.unsplitFiles).toEqual(['/_next/static/chunks/turbopack-x.js']);
    expect(r.over).toBe(true);
    expect(budgetReport([c], 350 * 1024).over).toBe(false);
  });
});
