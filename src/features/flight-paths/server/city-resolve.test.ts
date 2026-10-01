// R4 round 5 B2: the palette's "City to City" ("Main airport of each city") planned namesake minor
// airfields for major cities — "Bali to Sydney" → BLC (Bali, Cameroon) → BWU (Bankstown), "Kiev to
// Warsaw" → UKKM (Hostomel), "Lima" → LIMA (Torino-Aeritalia, an ICAO exact match of an ordinary
// word), "Xian" → XFN (a substring of "Xiangyang"), "St Petersburg" → SPG (the folded "st." missed
// LED). Now: hits that carry the typed name as whole words rank first, the city's main airport first
// among them (scheduled service → size → VRS services → IATA); an ordinary word is an ICAO code only
// for a scheduled airport or typed in capitals; and the palette plans only a main airport, otherwise
// it offers "No main airport found for … Did you mean …?".
// End-to-end over the bundled OurAirports index (searchAirports → JSON → resolvePlace), plus the
// reviewer's recorded round-5 answers (2026-10-01 14:14Z, __fixtures__/r5/search-*.json).
import { describe, expect, it } from 'vitest';
import { draftMessage, resolvePlace, routeOrDraft } from '../client/draft';
import { compareFuzzy, exactMatches, fuzzyMatches, searchAirports } from './airports';
import { findAirport, servicesAt } from './data';
import bali from '../__fixtures__/r5/search-Bali.json';
import bangalore from '../__fixtures__/r5/search-Bangalore.json';
import kiev from '../__fixtures__/r5/search-Kiev.json';
import stPetersburg from '../__fixtures__/r5/search-St_Petersburg.json';

const offline = { photon: async () => [], nominatim: async () => [] };
/** The search route's body for `q`, served to resolvePlace as /api/airports/search would. */
const live = (async (url: string) => {
  const q = new URL(url, 'http://x').searchParams.get('q') ?? '';
  const r = await searchAirports(q, { all: false, submit: true }, offline);
  return new Response(JSON.stringify({ query: q, results: r.results, metro: r.metro }), { status: 200 });
}) as unknown as typeof fetch;
const recorded = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

describe('a city name resolves to its main airport (round 5 B2, bundled index)', () => {
  const MAIN: [string, string][] = [
    // The reviewer's wrong answers, round 5 (what was planned → what the name means).
    ['Sydney', 'SYD'], // was BWU (Bankstown); SYD was 4th
    ['Athens', 'ATH'], // was AHN (Athens, Georgia)
    ['Vancouver', 'YVR'], // was CXH (seaplane base)
    ['Lima', 'LIM'], // was LIMA (ICAO exact: Torino-Aeritalia)
    ['Santiago', 'SCL'], // was SYP (Panama)
    ['Nairobi', 'NBO'], // was WIL
    ['Manila', 'MNL'], // was MXA (Manila, Arkansas)
    ['Orlando', 'MCO'], // was ORL
    ['Manchester', 'MAN'], // was MHT (New Hampshire)
    ['Glasgow', 'GLA'], // was GGW (Montana)
    ['Venice', 'VCE'], // was VNC (Florida)
    ['Naples', 'NAP'], // was APF (Florida)
    ['Baku', 'GYD'], // was UB18 (air base)
    ['Xian', 'XIY'], // was XFN (substring of "Xiangyang")
    ['St Petersburg', 'LED'], // was SPG (round 4 planned LED)
    ['Saint Petersburg', 'LED'],
    ['Bali', 'DPS'], // was BLC (Cameroon)
    ['Bangalore', 'BLR'], // was VOBG (HAL)
    // Metro groups and plain cities that were right stay right.
    ['Paris', 'CDG'],
    ['London', 'LHR'],
    ['Rome', 'FCO'],
    ['Tokyo', 'HND'],
    ['Berlin', 'BER'],
    ['Delhi', 'DEL'],
    ['Warsaw', 'WAW'],
    ['Honolulu', 'HNL'],
    ['Munich', 'MUC'],
    ['Heathrow', 'LHR'],
    // A town's own small scheduled field is its main airport.
    ['Lukla', 'LUA'],
  ];
  for (const [name, code] of MAIN) {
    it(`"${name}" → ${code}`, async () => {
      expect(await resolvePlace(name, live)).toEqual({ kind: 'found', code });
    });
  }

  it('the search ranks the main airport first, not the namesake with the higher MiniSearch score', () => {
    const syd = fuzzyMatches('Sydney', false);
    expect(syd[0]!.iata).toBe('SYD');
    // BWU scored higher (46.2 vs 39.7) and was planned in round 5.
    expect(syd.find((a) => a.iata === 'BWU')!.score).toBeGreaterThan(syd[0]!.score);
    expect(fuzzyMatches('Athens', false)[0]!.iata).toBe('ATH');
    expect(fuzzyMatches('Xian', false)[0]!.iata).toBe('XIY');
  });

  it('same scheduled size class: the airport more VRS services call at wins (Santiago: SCL over SCU, STI, SCQ)', () => {
    const [scl, stI] = [findAirport('SCL')!, findAirport('STI')!];
    expect(servicesAt('SCEL')).toBeGreaterThan(servicesAt('MDST'));
    const s = (a: typeof scl, score: number) => ({ a, score, named: true });
    expect(compareFuzzy(s(scl, 1), s(stI, 99))).toBeLessThan(0);
    // An unnamed hit never outranks a named one, whatever its score.
    expect(compareFuzzy({ a: stI, score: 999, named: false }, s(scl, 1))).toBeGreaterThan(0);
  });

  it('an ordinary word is an ICAO code only for a scheduled airport, or typed in capitals', () => {
    expect(exactMatches('Lima', false)).toEqual([]);
    expect(exactMatches('lima', false)).toEqual([]);
    expect(exactMatches('LIMA', false)[0]).toMatchObject({ ident: 'LIMA', matchedBy: 'icao' });
    expect(exactMatches('egll', false)[0]).toMatchObject({ iata: 'LHR', matchedBy: 'icao' });
    expect(exactMatches('lhr', false)[0]).toMatchObject({ iata: 'LHR', matchedBy: 'iata' });
  });

  it('no main airport: a "No main airport found" suggestion, never a silent plan', async () => {
    // Kyiv's airports have had no scheduled service since 2022 (OurAirports).
    expect(await resolvePlace('Kiev', live)).toEqual({ kind: 'none', suggestion: { code: 'IEV', label: 'Kyiv', named: true } });
    // An airfield typed by its own name, without scheduled service: offered, named by its name.
    expect(await resolvePlace('Bankstown', live)).toEqual({ kind: 'none', suggestion: { code: 'BWU', label: 'Sydney Bankstown Airport', named: true } });
    // Nothing carries the name: the round-4 wording.
    expect(await resolvePlace('Atlantis', live)).toEqual({ kind: 'none', suggestion: { code: 'ACY', label: 'Atlantic City' } });
  });

  it('the palette flows from the report: "Bali to Sydney", "Bangalore to Delhi", "Kiev to Warsaw"', async () => {
    const plan = async (a: string, b: string) => routeOrDraft(a, b, await resolvePlace(a, live), await resolvePlace(b, live));
    expect((await plan('Bali', 'Sydney')).route).toEqual({ from: 'DPS', to: 'SYD' });
    expect((await plan('Bangalore', 'Delhi')).route).toEqual({ from: 'BLR', to: 'DEL' });
    const kyiv = await plan('Kiev', 'Warsaw');
    expect(kyiv.route).toBeNull();
    expect(kyiv.draft).toMatchObject({ from: 'Kiev', to: 'WAW', unresolved: ['Kiev'], suggestions: [{ side: 'from', code: 'IEV', named: true }] });
    expect(draftMessage(kyiv.draft!)).toBe('No main airport found for "Kiev". Did you mean IEV (Kyiv)?');
  });
});

describe('the client judges recorded round-5 answers the same way (reviewer repro, palette-resolve-r5)', () => {
  it('"St Petersburg" → LED (municipality "St. Petersburg": punctuation folded), not SPG', async () => {
    expect(await resolvePlace('St Petersburg', recorded(stPetersburg))).toEqual({ kind: 'found', code: 'LED' });
  });

  it('"Bali" → DPS (keywords "Bali", scheduled, large), not BLC listed first (small, unscheduled)', async () => {
    expect(bali.results[0]!.iata).toBe('BLC');
    expect(await resolvePlace('Bali', recorded(bali))).toEqual({ kind: 'found', code: 'DPS' });
  });

  it('"Bangalore" → BLR (keywords "Bangalore"), not VOBG listed first (HAL, no scheduled service)', async () => {
    expect(bangalore.results[0]!.ident).toBe('VOBG');
    expect(await resolvePlace('Bangalore', recorded(bangalore))).toEqual({ kind: 'found', code: 'BLR' });
  });

  it('"Kiev" → no main airport; the city airport (IEV, with an IATA code) is suggested over Hostomel (UKKM)', async () => {
    expect(kiev.results[0]!.ident).toBe('UKKM');
    expect(await resolvePlace('Kiev', recorded(kiev))).toEqual({ kind: 'none', suggestion: { code: 'IEV', label: 'Kyiv', named: true } });
  });
});
