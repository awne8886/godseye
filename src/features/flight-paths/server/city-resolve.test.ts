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
import { NAME_RANK } from '../lib/names';
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
    const m = (a: typeof scl) => ({ ...a, keywords: null, services: servicesAt(a.icao), score: 0, matchedBy: 'fuzzy' as const });
    const s = (a: typeof scl, score: number) => ({ m: m(a), score, rank: NAME_RANK.town });
    expect(compareFuzzy(s(scl, 1), s(stI, 99))).toBeLessThan(0);
    // An unnamed hit never outranks a named one, whatever its score.
    expect(compareFuzzy({ m: m(stI), score: 999, rank: NAME_RANK.none }, s(scl, 1))).toBeGreaterThan(0);
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

describe('a person\'s name in an airport name does not outrank the city (round 5 B2 follow-up)', () => {
  // Reviewer sweep, worktree vs 4cc233a: these were planned to another country.
  const CITY: [string, string, string][] = [
    ['Sofia', 'SOF', 'TFS (Tenerife Sur, keyword "Reina Sofía")'],
    ['Malmö', 'MMX', 'CPH (keyword)'],
    ['Constantine', 'CZL', 'INI (Niš)'],
    ['Sucre', 'SRE', 'UIO (Quito, Mariscal Sucre)'],
    ['Windsor', 'YQG', 'NAS'],
    ['Datong', 'DAT', 'LHW'],
    ['Thompson', 'YTH', 'MHH'],
    ['Esperance', 'EPR', 'SFG'],
    ['Rivera', 'RVY', 'CPX'],
    ['Lancaster', 'LNS', 'MDT'],
  ];
  for (const [name, code, was] of CITY) {
    it(`"${name}" → ${code} (was ${was})`, async () => {
      expect(await resolvePlace(name, live)).toEqual({ kind: 'found', code });
    });
  }

  it('the type-ahead lists the city first too ("Sofia": SOF before TFS)', () => {
    const sofia = fuzzyMatches('Sofia', false).map((a) => a.iata);
    expect(sofia.indexOf('SOF')).toBeLessThan(sofia.indexOf('TFS'));
  });

  // The pick carries the name only in its airport name while scheduled airports in towns of that
  // name lie elsewhere: asked, one option per airport, never planned.
  const ASK: [string, string[]][] = [
    ['Jackson', ['JAN', 'JAC', 'MKL', 'ATL']],
    ['Nelson', ['NSN', 'RAI']],
    ['Pereira', ['PEI', 'BVC']],
    ['Bishop', ['BIH', 'GND']],
    ['David', ['DAV', 'KUT']],
    ['Hancock', ['CMX', 'SYR']],
  ];
  for (const [name, codes] of ASK) {
    it(`"${name}" asks: ${codes.join(', ')}`, async () => {
      const r = await resolvePlace(name, live);
      expect(r.kind).toBe('ambiguous');
      const got = r.kind === 'ambiguous' ? r.options.map((o) => o.code) : [];
      expect(got).toEqual(expect.arrayContaining(codes));
    });
  }

  it('"Cambridge" asks, and offers the town\'s own unscheduled field labelled as such (was HBA, Hobart)', async () => {
    const r = await resolvePlace('Cambridge', live);
    expect(r.kind).toBe('ambiguous');
    const opts = r.kind === 'ambiguous' ? r.options : [];
    expect(opts.find((o) => o.code === 'CBG')?.label).toBe('Cambridge, United Kingdom — no scheduled service');
    expect(opts.map((o) => o.code)).toContain('HBA');
  });

  it('the draft states the choice and offers every option ("Jackson to Denver")', async () => {
    const { route, draft } = routeOrDraft('Jackson', 'Denver', await resolvePlace('Jackson', live), await resolvePlace('Denver', live));
    expect(route).toBeNull();
    expect(draft).toMatchObject({ to: 'DEN', unresolved: ['Jackson'] });
    expect(draft!.suggestions!.map((x) => x.code)).toEqual(['JAN', 'JAC', 'MKL', 'ATL']);
    expect(draftMessage(draft!)).toBe(
      '"Jackson" names more than one airport. Did you mean JAN (Jackson, Mississippi), JAC (Jackson, Wyoming), MKL (Jackson, Tennessee) or ATL (Hartsfield Jackson Atlanta International Airport)?',
    );
  });
});

describe('a short word that is also an airport code means the airport bearing the name (round 5 B2)', () => {
  const WORD: [string, string, string][] = [
    ['Goa', 'GOI', 'GOA Genoa'],
    ['Kos', 'KGS', 'KOS Sihanoukville'],
    ['Leh', 'IXL', 'LEH Le Havre, unscheduled'],
    ['Osh', 'OSS', 'OSH Oshkosh, unscheduled'],
    ['Nis', 'INI', 'NIS Simberi, unscheduled'],
    ['Pau', 'PUF', 'PAU'],
    ['Gao', 'GAQ', 'GAO'],
    ['Hue', 'HUI', 'HUE Humera'],
    ['Sylt', 'GWT', 'ICAO SYLT Lethem'],
    ['Palu', 'PLW', 'LUR Cape Lisburne'],
    ['Sari', 'SRY', 'IGR'],
  ];
  for (const [name, code, was] of WORD) {
    it(`"${name}" → ${code} (was ${was})`, async () => {
      expect(await resolvePlace(name, live)).toEqual({ kind: 'found', code });
    });
  }

  it('a code typed as a code stays the code: "lhr", "LHR", "GOA", "Den" (no scheduled Den Helder)', async () => {
    expect(await resolvePlace('lhr', live)).toEqual({ kind: 'found', code: 'LHR' });
    expect(await resolvePlace('LHR', live)).toEqual({ kind: 'found', code: 'LHR' });
    expect(await resolvePlace('GOA', live)).toEqual({ kind: 'found', code: 'GOA' });
    expect(await resolvePlace('Den', live)).toEqual({ kind: 'found', code: 'DEN' });
  });

  it('"goa" in lower case could be either: asked (GOA Genoa or GOI Goa)', async () => {
    const r = await resolvePlace('goa', live);
    expect(r.kind === 'ambiguous' ? r.options.map((o) => o.code) : r).toEqual(['GOA', 'GOI']);
  });

  it('the search ranks the airport bearing the name first ("Goa": GOI before GOA)', async () => {
    const r = await searchAirports('Goa', { all: false, submit: false }, offline);
    expect(r.results.slice(0, 2).map((a) => a.iata)).toEqual(['GOI', 'GOA']);
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
