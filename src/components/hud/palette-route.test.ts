import { describe, expect, it, vi } from 'vitest';
import { useUiStore } from '@/lib/store';
import search from './__fixtures__/airports-search.2026-10-01.json';
import { destinationOf, isPlaceName, originOf, parseRouteQuery, queryItems } from './palette-items';

/** /api/airports/search answers recorded from a local production build on 2026-10-01 (zero keys). */
const recorded = (async (url: string) => {
  const q = new URL(url, 'http://x').searchParams.get('q') ?? '';
  const hit = (search.responses as Record<string, { status: number; body: unknown }>)[q];
  if (!hit) throw new Error(`no recorded search answer for "${q}"`);
  return new Response(JSON.stringify(hit.body), { status: hit.status });
}) as unknown as typeof fetch;

/**
 * Round 4 m4: command detection is position-aware. Real places whose first word is also a filler or
 * a verb ("Can Tho", "In Salah", "Hilton Head", "Show Low") are routes; a leading travel or
 * navigation verb ("drive to paris") never plans a flight. Ports R1's repro (r1r4.test.ts R1r4-m-pal).
 */
describe('palette route parsing is position-aware (round 4 m4)', () => {
  it.each([
    ['Can Tho to Hanoi', 'Can Tho', 'Hanoi'],
    ['In Salah to Algiers', 'In Salah', 'Algiers'],
    ['Hilton Head to Atlanta', 'Hilton Head', 'Atlanta'],
    ['Show Low to Phoenix', 'Show Low', 'Phoenix'],
    ['show low to phoenix', 'show low', 'phoenix'],
    ['London to New York', 'London', 'New York'],
    ['fly from Can Tho to Hanoi', 'Can Tho', 'Hanoi'],
    ['from In Salah to Algiers', 'In Salah', 'Algiers'],
    ['please fly from Hilton Head to Atlanta', 'Hilton Head', 'Atlanta'],
    ['I want to fly from London to New York', 'London', 'New York'],
    ['plan a route from Show Low to Phoenix', 'Show Low', 'Phoenix'],
    ['show me flights from Can Tho to Hanoi', 'Can Tho', 'Hanoi'],
    ['London to New York please', 'London', 'New York'],
  ])('%s → %s → %s', (q, from, to) => {
    expect(parseRouteQuery(q)).toEqual({ kind: 'names', from, to });
  });

  it('keeps typed codes after a flight verb', () => {
    expect(parseRouteQuery('fly from LHR to JFK')).toEqual({ kind: 'codes', from: 'LHR', to: 'JFK' });
    expect(parseRouteQuery('route lhr to jfk')).toEqual({ kind: 'codes', from: 'LHR', to: 'JFK' });
  });

  it.each([
    'drive to paris',
    'Drive to Paris',
    'walk to rome',
    'ride to berlin',
    'drive from london to paris',
    'open to paris',
    'head over to rome',
    'get me to paris',
    'go back to london',
    'show me to paris',
    'show to paris',
    'zoom in to paris',
    'please go to rome',
    'can you fly to tokyo',
    'fly to paris',
    'plan a route to rome',
    'from to rome',
  ])('%s is a command, not a route', (q) => {
    expect(parseRouteQuery(q)).toBeNull();
  });

  it('never strips a word from inside a name', () => {
    expect(originOf('Can Tho')).toBe('Can Tho');
    expect(originOf('In Salah')).toBe('In Salah');
    expect(originOf('Hilton Head')).toBe('Hilton Head');
    expect(originOf('Show Low')).toBe('Show Low');
    expect(originOf('fly from Can Tho')).toBe('Can Tho');
    expect(originOf('drive')).toBeNull();
    expect(originOf('zoom in')).toBeNull();
    expect(originOf('show me')).toBeNull();
  });

  it('"drive to paris" offers no palette action at all, so Enter can never plan Brive → Paris', () => {
    expect(queryItems('drive to paris', () => true)).toEqual([]);
    expect(queryItems('walk to rome', () => true)).toEqual([]);
  });

  it.each([
    ['fly from Can Tho to Hanoi', { from: 'VCA', to: 'HAN' }],
    ['In Salah to Algiers', { from: 'INZ', to: 'ALG' }],
    ['Hilton Head to Atlanta', { from: 'HHH', to: 'ATL' }],
    ['Show Low to Phoenix', { from: 'SOW', to: 'PHX' }],
    ['London to New York', { from: 'LHR', to: 'JFK' }],
  ])('Enter on "%s" plans %o with the recorded airport search', async (q, planned) => {
    useUiStore.setState({ plannedRoute: null, openPanel: null, flightIdent: null });
    const [item] = queryItems(q, () => true, recorded);
    expect(item!.id.startsWith('route-names:')).toBe(true);
    item!.run();
    expect(useUiStore.getState().openPanel).toBe('paths');
    await vi.waitFor(() => expect(useUiStore.getState().plannedRoute).toEqual(planned));
    useUiStore.setState({ plannedRoute: null, openPanel: null, flightIdent: null });
  });
});

/**
 * Round 5 M1 (r1-map-hud): conversational phrases never become flight routes. Before the fix
 * "now go to rome" offered "PLAN ROUTE NOW GO → ROME" as the top palette item and Enter opened PATHS
 * with FROM "NOW GO". Ports R1's scratch repro (round5/r1-map-hud/unit/palette.test.ts, pal.out).
 */
describe('palette never plans a route from speech (round 5 M1)', () => {
  it.each([
    'now go to rome',
    'I need to drive to paris',
    'i need to go to rome',
    'we should go to rome',
    'okay take me to london',
    'ok, take me to london',
    'just go to paris',
    'time to go to rome',
    'how do i get to paris',
    'How do I get to Paris?',
    'hey fly to rome',
    'Hey, fly to Rome',
    'quickly go to berlin',
    'then zoom to tokyo',
    'so fly to rome',
    'and then go to rome',
    'we need to head to rome',
    'we head to rome',
    'lol go to rome',
    'please now go to rome',
    'I want to fly to paris',
    // The destination is checked too: a command verb never opens a place name.
    'London to drive to Paris',
    'London to go',
    'London to zoom in',
    'Rome to show me paris',
    // A multi-leg request is not a two-point route.
    'London to New York to Paris',
  ])('%s is not a route', (q) => {
    expect(parseRouteQuery(q)).toBeNull();
    expect(queryItems(q, () => true)).toEqual([]);
  });

  it.each([
    ['Can Tho to Hanoi', 'Can Tho', 'Hanoi'],
    ['In Salah to Algiers', 'In Salah', 'Algiers'],
    ['Hilton Head to Atlanta', 'Hilton Head', 'Atlanta'],
    ['Atlanta to Hilton Head', 'Atlanta', 'Hilton Head'],
    ['Show Low to Phoenix', 'Show Low', 'Phoenix'],
    ['Phoenix to Show Low', 'Phoenix', 'Show Low'],
    ['Mountain View to Los Angeles', 'Mountain View', 'Los Angeles'],
    ['Orange Walk to Belize City', 'Orange Walk', 'Belize City'],
    ['Copper Center to Anchorage', 'Copper Center', 'Anchorage'],
    ['London to New York', 'London', 'New York'],
    ['fly from Can Tho to Hanoi', 'Can Tho', 'Hanoi'],
    ['now fly from London to Paris', 'London', 'Paris'],
    ['hey, fly from Can Tho to Hanoi', 'Can Tho', 'Hanoi'],
    ['I need to fly from Hilton Head to Atlanta', 'Hilton Head', 'Atlanta'],
    ['St. Louis to Chicago', 'St. Louis', 'Chicago'],
  ])('%s → %s → %s still plans', (q, from, to) => {
    expect(parseRouteQuery(q)).toEqual({ kind: 'names', from, to });
  });

  it('keeps capitalised airport codes that spell a verb ("CDG to RUN" is Réunion)', () => {
    expect(parseRouteQuery('CDG to RUN')).toEqual({ kind: 'codes', from: 'CDG', to: 'RUN' });
    expect(parseRouteQuery('GET to PER')).toEqual({ kind: 'codes', from: 'GET', to: 'PER' });
    expect(parseRouteQuery('lhr to jfk')).toEqual({ kind: 'codes', from: 'LHR', to: 'JFK' });
  });

  it('checks verbs at every position of a name, with the real place prefixes and suffixes allowed', () => {
    expect(isPlaceName(['now', 'go'])).toBe(false);
    expect(isPlaceName(['hey', 'fly'])).toBe(false);
    expect(isPlaceName(['how', 'do', 'i', 'get'])).toBe(false);
    expect(isPlaceName(['we', 'head'])).toBe(false);
    expect(isPlaceName(['hilton', 'head', 'island'])).toBe(true);
    expect(isPlaceName(['frying', 'pan', 'island'])).toBe(true);
    expect(isPlaceName(['show', 'low'])).toBe(true);
    expect(isPlaceName(['show', 'me'])).toBe(false);
    expect(isPlaceName(['drive', 'to', 'paris'])).toBe(false);
    expect(isPlaceName(['new', 'york', 'to', 'paris'])).toBe(false);
    expect(originOf('now go')).toBeNull();
    expect(originOf('I need')).toBe('I need'); // a bare left side is judged with its destination
    expect(destinationOf('drive to paris')).toBeNull();
    expect(destinationOf('go to rome')).toBeNull();
    expect(destinationOf('Paris please')).toBe('Paris');
  });

  it('Enter on "now go to rome" can never open PATHS with FROM "NOW GO"', () => {
    useUiStore.setState({ plannedRoute: null, openPanel: null, flightIdent: null });
    for (const q of ['now go to rome', 'I need to drive to paris', 'just go to paris', 'hey fly to rome', 'then zoom to tokyo', 'how do i get to paris']) {
      expect(queryItems(q, () => true).some((i) => i.id.startsWith('route'))).toBe(false);
    }
    expect(useUiStore.getState().openPanel).toBeNull();
  });
});
