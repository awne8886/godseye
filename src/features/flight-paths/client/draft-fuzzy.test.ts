// R4 round 4 M2: the palette's "Plan route X → Y" planned whatever /api/airports/search?submit=1
// answered first. Fixtures: that endpoint's live answers on 2026-10-01 05:21Z ("Atlantis" → ACY,
// fuzzy 21.97; "qwerty" → PNA via Photon; "London" → the London metro group).
import { describe, expect, it } from 'vitest';
import atlantis from '../__fixtures__/r4/search-Atlantis.json';
import london from '../__fixtures__/r4/search-London.json';
import qwerty from '../__fixtures__/r4/search-qwerty.json';
import { draftMessage, fold, meansTyped, resolvePlace, routeOrDraft } from './draft';

const recorded = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

describe('palette names resolve only to airports the name actually means (round 4 M2)', () => {
  it('"Atlantis to London" is a draft with "Did you mean ACY (Atlantic City)?", not a planned ACY→LHR', async () => {
    const a = await resolvePlace('Atlantis', recorded(atlantis));
    const b = await resolvePlace('London', recorded(london));
    expect(a).toEqual({ kind: 'none', suggestion: { code: 'ACY', label: 'Atlantic City' } });
    expect(b).toEqual({ kind: 'found', code: 'LHR' });
    const out = routeOrDraft('Atlantis', 'London', a, b);
    expect(out.route).toBeNull();
    expect(out.draft).toMatchObject({ from: 'Atlantis', to: 'LHR', unresolved: ['Atlantis'], suggestions: [{ side: 'from', text: 'Atlantis', code: 'ACY', label: 'Atlantic City' }] });
    expect(draftMessage(out.draft!)).toBe('No airport named "Atlantis". Did you mean ACY (Atlantic City)?');
  });

  it('"qwerty" (Photon geocode → nearest airport) is not an airport city: a suggestion only', async () => {
    const a = await resolvePlace('qwerty', recorded(qwerty));
    expect(a).toEqual({ kind: 'none', suggestion: { code: 'PNA', label: 'Pamplona' } });
  });

  it('a fuzzy hit whose name, municipality or keywords contain the typed text (case/accent folded) resolves', () => {
    const muc = { iata: 'MUC', icao: 'EDDM', ident: 'EDDM', name: 'Munich Airport', municipality: 'Munich', keywords: 'Franz Josef Strauss, München', matchedBy: 'fuzzy' };
    expect(meansTyped(muc, 'MUNCHEN')).toBe(true);
    expect(meansTyped(muc, 'munich')).toBe(true);
    expect(meansTyped(muc, 'Munchkin')).toBe(false);
    expect(meansTyped({ ...muc, matchedBy: 'photon' }, 'Munich')).toBe(false);
    expect(meansTyped({ ...muc, matchedBy: 'iata' }, 'xyz')).toBe(true);
    expect(fold('  Zürich   Flughafen ')).toBe('zurich flughafen');
  });

  it('both ends unresolved carry one suggestion each, keyed to the typed text', () => {
    const out = routeOrDraft('Atlantis', 'qwerty', { kind: 'none', suggestion: { code: 'ACY', label: 'Atlantic City' } }, { kind: 'none', suggestion: { code: 'PNA', label: 'Pamplona' } });
    expect(out.draft!.suggestions!.map((s) => `${s.side}:${s.code}`)).toEqual(['from:ACY', 'to:PNA']);
    expect(draftMessage(out.draft!)).toBe('No airport named "Atlantis". Did you mean ACY (Atlantic City)? No airport named "qwerty". Did you mean PNA (Pamplona)?');
  });
});
