/**
 * R3 round-4 MINOR-5: the dossier showed Ukraine's population as 41.2 M with no date. Population now
 * comes from the World Bank (dated, keyless) with its year; Wikidata's best-rank P1082 is the
 * fallback and carries its own P585 year. Also MINOR-9: the SCMP wire URL keeps its trailing slash.
 * Fixtures captured 2026-10-01 05:38–05:40 UTC (World Bank UA/TW, Wikidata SPARQL with ?popDate).
 */
import { describe, expect, it } from 'vitest';
import { FX, fixtureJson } from '../__fixtures__';
import { countrySparql, parseCountry, parseWorldBankPopulation, withPopulation, worldBankPopulationUrl } from './dossier';
import { WIRE_FEEDS } from './news';

describe('dossier population (dated)', () => {
  it('reads the latest World Bank year and value', () => {
    expect(parseWorldBankPopulation(fixtureJson(FX.worldBankUA))).toEqual({ value: 38980376, year: 2025 });
    expect(worldBankPopulationUrl('UA')).toBe('https://api.worldbank.org/v2/country/UA/indicator/SP.POP.TOTL?format=json&mrnev=1');
  });

  it('treats an economy the Bank does not cover as "no figure" and a malformed body as a parse error', () => {
    expect(parseWorldBankPopulation(fixtureJson(FX.worldBankTW))).toBeNull();
    expect(() => parseWorldBankPopulation({ message: 'x' })).toThrow('parse');
  });

  it('keeps the Wikidata figure with its P585 year when the Bank has none', () => {
    const c = parseCountry(fixtureJson(FX.sparqlUAPopDate), 'UA');
    expect(c).toMatchObject({ population: 41167335, populationSource: { name: 'Wikidata P1082', year: 2022, url: 'https://www.wikidata.org/wiki/Q212#P1082' } });
    expect(withPopulation(c, null, 'UA')).toBe(c);
    expect(countrySparql('UA')).toContain('pq:P585 ?popDate');
  });

  it('prefers the dated World Bank figure and names it', () => {
    const c = withPopulation(parseCountry(fixtureJson(FX.sparqlUAPopDate), 'UA'), { value: 38980376, year: 2025 }, 'UA');
    expect(c).toMatchObject({ population: 38980376, populationSource: { name: 'World Bank (SP.POP.TOTL)', year: 2025, url: 'https://data.worldbank.org/indicator/SP.POP.TOTL?locations=UA' } });
  });

  it('marks a Wikidata figure without a point-in-time as undated (year null)', () => {
    expect(parseCountry(fixtureJson(FX.sparqlUA), 'UA')?.populationSource).toMatchObject({ name: 'Wikidata P1082', year: null });
  });
});

describe('SCMP wire URL (R3 round-4 MINOR-9)', () => {
  it('uses the https URL with the trailing slash (without it SCMP answers 301 to http://, which http.ts refuses)', () => {
    expect(WIRE_FEEDS.find((w) => w.handle === 'scmp')?.url).toBe('https://www.scmp.com/rss/91/feed/');
  });
});
