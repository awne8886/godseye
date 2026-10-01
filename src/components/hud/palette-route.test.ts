import { describe, expect, it, vi } from 'vitest';
import { useUiStore } from '@/lib/store';
import search from './__fixtures__/airports-search.2026-10-01.json';
import { originOf, parseRouteQuery, queryItems } from './palette-items';

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
