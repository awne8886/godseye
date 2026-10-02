import { describe, expect, it } from 'vitest';
import { draftMessage, resolvePlace, routeOrDraft } from './draft';

const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

describe('palette place resolution (round 3 m5)', () => {
  it('metro group first, else the best match, else none', async () => {
    expect(await resolvePlace('London', reply(200, { results: [{ iata: 'LCY', icao: 'EGLC', ident: 'EGLC' }], metro: { codes: ['LHR', 'LGW'] } }))).toEqual({
      kind: 'found',
      code: 'LHR',
      metro: { name: 'London', codes: ['LHR', 'LGW'] },
    });
    expect(await resolvePlace('Heathrow', reply(200, { results: [{ iata: 'LHR', icao: 'EGLL', ident: 'EGLL', name: 'London Heathrow Airport', municipality: 'London', matchedBy: 'fuzzy' }], metro: null }))).toEqual({ kind: 'found', code: 'LHR' });
    expect(await resolvePlace('Qwxz', reply(200, { results: [], metro: null }))).toEqual({ kind: 'none' });
  });

  it('a 5xx or a network error is "failed", never "no airport found"', async () => {
    expect(await resolvePlace('London', reply(503, { error: 'source_offline' }))).toEqual({ kind: 'failed' });
    const boom = (async () => {
      throw new TypeError('network');
    }) as unknown as typeof fetch;
    expect(await resolvePlace('London', boom)).toEqual({ kind: 'failed' });
    const d = routeOrDraft('London', 'New York', { kind: 'failed' }, { kind: 'found', code: 'JFK' });
    expect(d.route).toBeNull();
    expect(draftMessage(d.draft!)).toBe('Airport search did not answer for "London" — try again, or type an airport code.');
  });

  it('both names on one airport says so instead of staying silent', () => {
    const d = routeOrDraft('London', 'Heathrow', { kind: 'found', code: 'LHR' }, { kind: 'found', code: 'LHR' });
    expect(d.route).toBeNull();
    expect(draftMessage(d.draft!)).toBe('Both ends resolve to LHR — pick a different airport for one end.');
  });

  it('two distinct airports plan the route', () => {
    expect(routeOrDraft('London', 'New York', { kind: 'found', code: 'LHR' }, { kind: 'found', code: 'JFK' })).toEqual({ route: { from: 'LHR', to: 'JFK' }, draft: null });
  });

  it('unresolved names keep the old wording', () => {
    const d = routeOrDraft('Atlantis', 'New York', { kind: 'none' }, { kind: 'found', code: 'JFK' });
    expect(d.draft).toMatchObject({ from: 'Atlantis', to: 'JFK', unresolved: ['Atlantis'], failed: [], same: null, suggestions: [] });
    expect(draftMessage(d.draft!)).toMatch(/^No airport found for "Atlantis"/);
  });

  it('round 10 MAJOR 3: names resolved through metro groups carry the groups to PATHS (London to New York)', async () => {
    const london = await resolvePlace('London', reply(200, { results: [], metro: { name: 'London', codes: ['LHR', 'LGW', 'STN', 'LTN', 'LCY', 'SEN'] } }));
    const ny = await resolvePlace('New York', reply(200, { results: [], metro: { name: 'New York', codes: ['JFK', 'EWR', 'LGA'] } }));
    const r = routeOrDraft('London', 'New York', london, ny);
    expect(r.route).toEqual({ from: 'LHR', to: 'JFK' });
    expect(r.metro).toEqual({ from: { name: 'London', codes: ['LHR', 'LGW', 'STN', 'LTN', 'LCY', 'SEN'] }, to: { name: 'New York', codes: ['JFK', 'EWR', 'LGA'] } });
    // A single-airport group is not a choice.
    expect(await resolvePlace('X', reply(200, { results: [], metro: { name: 'X', codes: ['XXX'] } }))).toEqual({ kind: 'found', code: 'XXX' });
    // An unresolved other end keeps the resolved end's group on the draft.
    const d = routeOrDraft('London', 'Atlantis', london, { kind: 'none' });
    expect(d.draft?.metro).toEqual({ from: london.kind === 'found' ? london.metro : undefined });
  });
});
