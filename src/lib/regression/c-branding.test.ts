// Phase 3 round 3: user-facing data (camera registry rows shown on /cameras-notice and
// /api/cctv/providers, the endpoint catalogue rendered on /docs and /privacy, the sources
// register) never carries the OSIRIS name; the MIT credit lives in LICENSE/README only.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXCLUDED_SOURCES, NOT_WIRED_SOURCES, PROVIDERS } from '@/features/surveillance/server/registry';
import { API_CATALOG } from '@/lib/api-catalog';
import { SOURCES } from '@/lib/sources';

const hits = (rows: readonly unknown[]) => rows.filter((r) => /osiris/i.test(JSON.stringify(r)));

describe('no OSIRIS branding in user-facing data', () => {
  it('camera registry, catalogue text and sources register', () => {
    expect(hits([...PROVIDERS, ...EXCLUDED_SOURCES, ...NOT_WIRED_SOURCES])).toEqual([]);
    // `osiris: boolean` is an internal parity flag, never rendered; check the rendered strings only.
    expect(hits(API_CATALOG.map(({ summary, params }) => ({ summary, params })))).toEqual([]);
    // The one allowed mention: the MIT credit row for the reused data tables.
    expect(hits(SOURCES.filter((s) => s.id !== 'osiris-curated'))).toEqual([]);
  });
});

// §11: no OSIRIS branding anywhere it ships. The only allowed mentions are the internal parity
// flag (`osiris: boolean`, EXCLUDED_OSIRIS_ROUTES — never rendered), the `osiris-curated` source
// id, and the MIT credit strings for the reused data tables; README credits OSIRIS only under
// "Credits and licence"; the generated API reference never names it.
const BRAND = /osiris|simplifaisoul|pump\.fun|eye of horus/i;
const ALLOWED = [
  /\bosiris: (?:true|false|boolean)/g,
  /EXCLUDED_OSIRIS_ROUTES/g,
  /'osiris-curated'/g,
  /\(OSIRIS, MIT\)/g,
];

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const f = path.join(dir, name);
    if (statSync(f).isDirectory()) {
      if (name !== '__fixtures__') sourceFiles(f, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(f);
  }
  return out;
}

describe('§11 branding scope', () => {
  const root = path.resolve(__dirname, '../../..');

  it('shipped source names OSIRIS only in the allowed flag, id and MIT credit strings', () => {
    const offenders: string[] = [];
    for (const f of sourceFiles(path.join(root, 'src'))) {
      stripComments(readFileSync(f, 'utf8'))
        .split('\n')
        .forEach((line, i) => {
          const rest = ALLOWED.reduce((s, re) => s.replace(re, ''), line);
          if (BRAND.test(rest)) offenders.push(`${path.relative(root, f)}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it('README credits OSIRIS only in "Credits and licence"; API.md never names it', () => {
    const readme = readFileSync(path.join(root, 'README.md'), 'utf8');
    const credits = readme.indexOf('\n## Credits and licence');
    expect(credits).toBeGreaterThan(0);
    expect(BRAND.test(readme.slice(0, credits))).toBe(false);
    expect(BRAND.test(readFileSync(path.join(root, 'docs/API.md'), 'utf8'))).toBe(false);
  });
});
