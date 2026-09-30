import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LICENCE_SUMMARY, OUTPUT_PATH, SOURCES_DIR, compileDataSources, demoteHeadings, orderAgents, readLogs } from './compile-data-sources';

describe('compile-data-sources', () => {
  it('orders the lead first, then agents alphabetically, Markdown only', () => {
    expect(orderAgents(['zeta.md', 'lead.md', 'alpha.md', 'notes.txt'])).toEqual(['lead.md', 'alpha.md', 'zeta.md']);
  });

  it('demotes headings one level, never inside code fences, capped at h6', () => {
    const src = '# Agent\n## Probes\n```\n# not a heading\n```\n###### deep\n#no-space';
    expect(demoteHeadings(src)).toBe('## Agent\n### Probes\n```\n# not a heading\n```\n###### deep\n#no-space');
  });

  it('includes every agent log verbatim (headings demoted) and links each one', () => {
    const logs = [
      { file: 'lead.md', content: '# lead — probe log\n\n| URL | Status |\n|---|---|\n| `https://a.example` | 200 |\n' },
      { file: 'layers-space.md', content: '# layers-space\n\n## CelesTrak\n\nnotes' },
    ];
    const out = compileDataSources(logs);
    expect(out).toContain('## lead — probe log');
    expect(out).toContain('| `https://a.example` | 200 |');
    expect(out).toContain('### CelesTrak');
    expect(out).toContain('- [layers-space](data-sources/layers-space.md)');
    expect(out.indexOf('## lead')).toBeLessThan(out.indexOf('## layers-space'));
  });

  it('summarises the licences the contract names', () => {
    const out = compileDataSources([]);
    const expectations: [RegExp, RegExp][] = [
      [/abuse\.ch/, /not-for-profit/i],
      [/ip-api\.com/, /non-commercial/i],
      [/InternetDB/, /non-commercial/i],
      [/OpenSanctions/, /CC BY-NC 4\.0/],
      [/Cloudflare Radar/, /CC BY-NC 4\.0/],
      [/TeleGeography/, /CC BY-NC-SA/],
      [/gpsjam/, /not stated/i],
      [/OpenFlights/, /ODbL.*2014/],
      [/^OpenStreetMap/, /ODbL/],
      [/Esri/, /Esri, Vantor, Earthstar Geographics/],
      [/NASA GIBS/, /acknowledgement/i],
    ];
    for (const [source, terms] of expectations) {
      const row = LICENCE_SUMMARY.find((r) => source.test(r.source));
      expect(row, String(source)).toBeDefined();
      expect(row!.terms, String(source)).toMatch(terms);
    }
    for (const r of LICENCE_SUMMARY) {
      expect(r.url).toMatch(/^https:\/\//);
      expect(out).toContain(`<${r.url}>`);
    }
  });

  it('docs/DATA_SOURCES.md is compiled from every file in docs/data-sources/', () => {
    const logs = readLogs();
    expect(logs.map((l) => l.file)).toEqual(orderAgents(readdirSync(SOURCES_DIR)));
    expect(logs.some((l) => l.file === 'pages-docs-privacy-ops.md')).toBe(true);
    const onDisk = readFileSync(OUTPUT_PATH, 'utf8');
    const fresh = compileDataSources(logs);
    expect(onDisk === fresh, 'docs/DATA_SOURCES.md is stale: node --experimental-transform-types --import ./tools/ts-loader.mjs tools/compile-data-sources.ts').toBe(true);
  });
});
