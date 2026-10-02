import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CAPABILITIES, type CapabilityId, type CapabilitySpec } from '@/lib/capabilities';
import { SOURCES } from '@/lib/sources';
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

  it('has a row for every source behind a licence gate (non-commercial or opt-in), with that gate named', () => {
    // A licence gate: off on commercial deployments, or an explicit licence/personal-use opt-in.
    const licenceGate = (id: CapabilityId) => {
      const spec: CapabilitySpec = CAPABILITIES[id];
      return spec.invertFlag === 'COMMERCIAL_DEPLOYMENT' || ['OPENSKY_LICENSED', 'ADSBFI_PERSONAL_USE', 'NONCOMMERCIAL'].includes(spec.flag ?? '');
    };
    const gated = SOURCES.filter((src) => src.gate?.capability && licenceGate(src.gate.capability));
    expect(gated.map((g) => g.id)).toEqual(expect.arrayContaining(['aeroapi', 'cam:edmonton', 'abusech', 'telegeography', 'opensanctions']));
    const lower = (x: string) => x.toLowerCase();
    for (const src of gated) {
      const row = LICENCE_SUMMARY.find((r) => lower(r.source).includes(lower(src.name)) || lower(src.name).includes(lower(r.source)));
      expect(row, `LICENCE_SUMMARY has no row for ${src.name}`).toBeDefined();
      const spec: CapabilitySpec = CAPABILITIES[src.gate!.capability!];
      expect(row!.gate.includes(src.gate!.capability!) || (spec.flag !== undefined && row!.gate.includes(spec.flag)), src.name).toBe(true);
    }
  });

  it('lists the round-6 sources with their terms: AeroAPI, Edmonton, MLIT, FAA ADDS', () => {
    const expectations: [RegExp, RegExp, RegExp][] = [
      [/AeroAPI/, /personal or academic purposes only/, /aeroapi.*COMMERCIAL_DEPLOYMENT/],
      [/City of Edmonton/, /personal, educational or non-commercial/, /nc_sources.*link-out/],
      [/MLIT/, /PDL 1\.0.*prefecture-owned/, /link-outs only.*出典/],
      [/FAA ADDS/, /public domain/, /build-time snapshot/],
    ];
    for (const [source, terms, gate] of expectations) {
      const row = LICENCE_SUMMARY.find((r) => source.test(r.source));
      expect(row, String(source)).toBeDefined();
      expect(row!.terms, String(source)).toMatch(terms);
      expect(row!.gate, String(source)).toMatch(gate);
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
