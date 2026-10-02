'use client';
/**
 * A typed-but-unresolved route handed to the PATHS panel (e.g. the command palette's "Plan route
 * LONDON → NEW YORK" when a name matched no airport): the panel pre-fills FROM/TO with the text and
 * tells the visitor which side found nothing, instead of the command failing silently (R4-m6).
 * Round 4 M2: the search always answers with fuzzy or geocoded candidates ("Atlantis" → ACY), so a
 * candidate is planned only when the name actually means it; otherwise the draft offers it as
 * "Did you mean ACY (Atlantic City)?" with a one-click accept.
 * Round 5 B2: "Main airport of each city" — a city name is planned only to an airport that carries
 * the name as whole words AND is that name's main airport (scheduled service, large or medium, or
 * the town's own small scheduled field); a namesake minor field ("Sydney" → Bankstown, "Bali" →
 * Bali, Cameroon) is never planned silently: it is offered as "No main airport found for …".
 * Round 5 follow-up: the main airport is ranked by how it carries the name (its town before a
 * person's name in an airport name: "Sofia" is SOF, not Tenerife Sur's "Reina Sofía"); a name that
 * points at several places ("Jackson": Jackson MS/WY/TN or Hartsfield–Jackson Atlanta; "goa": the
 * code GOA or Goa's GOI) is asked, with one option per airport, never guessed (`lib/place-rank.ts`).
 * Round 10 (§8 chooser): a name that resolves through a metro group ("London", "New York") carries
 * the group's airports, so PATHS lists them as chips under FROM/TO with the planned one selected.
 * A tiny external store (UI hand-off only, no data). Client-only.
 */
import { useSyncExternalStore } from 'react';
import { foldName, nameMatch, nameRank, NAME_RANK, townsOf, wordNotCode } from '../lib/names';
import { exactOrName, farNamesakes, isMainAirport, mainAmong } from '../lib/place-rank';

/** The search's best candidate for a name that did not resolve to an airport by itself. */
export interface PlaceSuggestion {
  code: string;
  /** Municipality, else the airport name (the airport name when that is what the typed text matched). */
  label: string;
  /**
   * True when airports carry the typed name but none is the name's main airport (no scheduled
   * service, or a minor field matched by its name only): "No main airport found for …".
   */
  named?: boolean;
  /** One of several airports the typed name may mean ("Jackson", "goa"): offered side by side. */
  ambiguous?: boolean;
  /** R4 m7: the airport is the nearest to a geocoded place, not a name match — disclosed with the place and distance. */
  near?: { place: string; source: 'photon' | 'nominatim'; distanceKm: number };
}

/** A suggestion attached to one end of a draft. */
export interface DraftSuggestion extends PlaceSuggestion {
  side: 'from' | 'to';
  /** The text the visitor typed for that end. */
  text: string;
}

/** The airports of the metro group a typed name resolved through ("London": LHR LGW STN LTN LCY SEN). */
export interface MetroChoice {
  name: string;
  codes: string[];
}

export interface PathsDraft {
  from: string;
  to: string;
  /** The typed names that resolved to no airport (the search answered with nothing that the name means). */
  unresolved: string[];
  /** The typed names whose airport search failed (network error / non-2xx): unknown, not "none". */
  failed?: string[];
  /** Both names resolved to this one airport (e.g. "London to Heathrow"). */
  same?: string | null;
  /** Best candidates for unresolved names (several for an ambiguous name), offered with a one-click accept (never planned silently). */
  suggestions?: DraftSuggestion[];
  /** Metro groups the typed names resolved through, listed as one-click chips per end (round 10). */
  metro?: { from?: MetroChoice; to?: MetroChoice };
  /** Increments per hand-off so the same text twice still re-applies. */
  seq: number;
}

let current: PathsDraft | null = null;
let seq = 0;
const listeners = new Set<() => void>();

export function setPathsDraft(d: Omit<PathsDraft, 'seq'> | null): void {
  current = d ? { ...d, seq: ++seq } : null;
  for (const l of listeners) l();
}

export function getPathsDraft(): PathsDraft | null {
  return current;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function usePathsDraft(): PathsDraft | null {
  return useSyncExternalStore(subscribe, getPathsDraft, () => null);
}

/** The ends of a draft still holding typed text that resolved to no airport (none or failed). */
export function pendingSides(d: Pick<PathsDraft, 'from' | 'to' | 'unresolved' | 'failed'>): Set<DraftSuggestion['side']> {
  const open = new Set([...d.unresolved, ...(d.failed ?? [])]);
  const out = new Set<DraftSuggestion['side']>();
  if (open.has(d.from)) out.add('from');
  if (open.has(d.to)) out.add('to');
  return out;
}

const option = (s: PlaceSuggestion) => `${s.code} (${s.label}${s.near ? `, ${Math.round(s.near.distanceKm)} km` : ''})`;

/** "Nearest airport to Atlantis, Bahamas (photon)" — how a geocoded suggestion was found. */
export function nearText(n: NonNullable<PlaceSuggestion['near']>): string {
  return `Nearest airport to ${n.place} (${n.source}):`;
}

/** "Did you mean ACY (Atlantic City)?"; several: "Did you mean JAN (…), JAC (…) or ATL (…)?" */
export function suggestionText(s: PlaceSuggestion | readonly PlaceSuggestion[]): string {
  const list = Array.isArray(s) ? (s as readonly PlaceSuggestion[]) : [s as PlaceSuggestion];
  const head = list.slice(0, -1).map(option).join(', ');
  return `Did you mean ${head ? `${head} or ` : ''}${option(list[list.length - 1]!)}?`;
}

/** The message shown in PATHS for a draft (round 3 m5: a failed search is not "no airport found"). */
export function draftMessage(d: Pick<PathsDraft, 'unresolved' | 'failed' | 'same' | 'suggestions'>): string | null {
  const parts: string[] = [];
  const q = (names: readonly string[]) => names.map((n) => `"${n}"`).join(' or ');
  if (d.failed?.length) parts.push(`Airport search did not answer for ${q(d.failed)} — try again, or type an airport code.`);
  const suggested = new Map<string, DraftSuggestion[]>();
  for (const s of d.suggestions ?? []) suggested.set(s.text, [...(suggested.get(s.text) ?? []), s]);
  for (const name of d.unresolved) {
    const list = suggested.get(name);
    if (!list?.length) continue;
    const first = list[0]!;
    if (first.ambiguous) parts.push(`"${name}" names more than one airport. ${suggestionText(list)}`);
    else parts.push(`${first.named ? `No main airport found for "${name}".` : `No airport named "${name}".`} ${first.near ? `${nearText(first.near)} ` : ''}${suggestionText(first)}`);
  }
  const bare = d.unresolved.filter((n) => !suggested.has(n));
  if (bare.length) parts.push(`No airport found for ${q(bare)} — type a city, airport name or code and pick from the list.`);
  if (d.same) parts.push(`Both ends resolve to ${d.same} — pick a different airport for one end.`);
  return parts.length ? parts.join(' ') : null;
}

export type PlaceResolution =
  /** `metro`: the group the name resolved through, when it has more than one airport. */
  | { kind: 'found'; code: string; metro?: MetroChoice }
  | { kind: 'none'; suggestion?: PlaceSuggestion | null }
  /** The name may mean several airports ("Jackson"): the visitor picks one. */
  | { kind: 'ambiguous'; options: PlaceSuggestion[] }
  | { kind: 'failed' };

interface SearchHit {
  iata: string | null;
  icao: string | null;
  ident: string;
  name?: string | null;
  municipality?: string | null;
  keywords?: string | null;
  matchedBy?: string;
  type?: string;
  scheduledService?: boolean;
  lat?: number;
  lng?: number;
  country?: string | null;
  region?: string | null;
  services?: number;
  distanceKm?: number;
}

/** Case-, accent- and punctuation-folded text ("St. Petersburg" ≡ "st petersburg", "Zürich" ≡ "zurich"). */
export const fold = foldName;

const EXACT: ReadonlySet<string> = new Set(['metro', 'iata', 'icao', 'ident']);

/**
 * Does this hit mean what was typed? An exact code or metro match always does; a fuzzy hit only
 * when its name, municipality or keywords carry the typed words as whole words (`nameMatch`:
 * "Xian" is not "Xiangyang", "St Petersburg" is "St. Petersburg"). Geocoded (Photon/Nominatim →
 * nearest airport) hits never do: they are suggestions.
 */
export function meansTyped(hit: SearchHit, typed: string): boolean {
  if (hit.matchedBy !== undefined && EXACT.has(hit.matchedBy)) return true;
  if (hit.matchedBy !== 'fuzzy') return false;
  return nameMatch(hit, typed) !== null;
}

const codeOfHit = (a: SearchHit) => a.iata ?? a.icao ?? a.ident;

/**
 * The name's main airport among hits that carry it (`mainAmong`: scheduled service → size → IATA
 * code → its town > part of its town's name > elsewhere in its municipality > its airport name > a
 * keyword → VRS services; then the busiest airport of that class in the area named for the place);
 * the server's order breaks the remaining ties.
 */
const mainOf = (named: readonly SearchHit[], typed: string): SearchHit | null => mainAmong(named, typed);

function suggestionOf(a: SearchHit, typed: string, named: boolean): PlaceSuggestion {
  const code = codeOfHit(a);
  // Matched by its own name ("Bankstown"): show that name; otherwise the town it serves.
  const label = nameMatch(a, typed) === 'name' ? (a.name ?? code) : a.municipality || a.name || code;
  return named ? { code, label, named } : { code, label };
}

/**
 * Options for an ambiguous name: an airport in a town of that name is labelled by the town (with its
 * country, or its region where two share a country: "Jackson, Mississippi"); any other by its own
 * name ("Hartsfield Jackson Atlanta International Airport", "Genoa Cristoforo Colombo Airport").
 */
function optionsOf(hits: readonly SearchHit[], typed: string): PlaceSuggestion[] {
  const town = (a: SearchHit) => (a.municipality && nameRank(a, typed) >= NAME_RANK.townPart ? townsOf(a.municipality).join('/') : null);
  const towns = hits.map(town);
  const countries = hits.map((a) => a.country ?? null);
  return hits.map((a, i) => {
    const code = codeOfHit(a);
    const t = towns[i];
    // An airport without scheduled service is offered only when the visitor picks it, and says so.
    const note = a.scheduledService === false ? ' — no scheduled service' : '';
    if (!t) return { code, label: `${a.name ?? code}${note}`, ambiguous: true };
    const twin = towns.some((x, j) => j !== i && x === t && countries[j] === countries[i]);
    const where = twin ? (a.region ?? a.country) : a.country;
    return { code, label: `${where ? `${t}, ${where}` : t}${note}`, ambiguous: true };
  });
}

/** At most this many options for an ambiguous name. */
export const MAX_OPTIONS = 4;

const EXACT_CODE: ReadonlySet<string> = new Set(['iata', 'icao', 'ident']);

/**
 * One airport code for a place name via /api/airports/search: the metro group's first airport; an
 * exact code unless the name means another airport (`exactOrName`: "Goa" is GOI, not Genoa's GOA;
 * "goa" asks); else the main airport among the hits that carry the name (`mainOf`, `isMainAirport`)
 * unless scheduled airports in towns of that name lie elsewhere (`farNamesakes`: "Jackson" asks);
 * otherwise `none` with the best candidate as a suggestion (round 4 M2: "Atlantis" is not ACY; round
 * 5 B2: "Sydney" is not Bankstown, "Lima" is not Torino's LIMA).
 */
export async function resolvePlace(name: string, fetchImpl: typeof fetch = fetch): Promise<PlaceResolution> {
  try {
    const r = await fetchImpl(`/api/airports/search?q=${encodeURIComponent(name)}&submit=1`);
    if (!r.ok) return r.status === 404 ? { kind: 'none' } : { kind: 'failed' };
    const body = (await r.json()) as { results?: SearchHit[]; metro?: { name?: string; codes: string[] } | null; place?: { name: string; country: string | null; source: 'photon' | 'nominatim' } | null };
    const results = body.results ?? [];
    const metroCodes = body.metro?.codes?.length ? body.metro.codes : results.filter((a) => a.matchedBy === 'metro').map(codeOfHit);
    if (metroCodes[0]) {
      const group = metroCodes.length > 1 ? { metro: { name: body.metro?.name ?? name, codes: metroCodes } } : {};
      return { kind: 'found', code: metroCodes[0], ...group };
    }
    // Hits that carry the typed name as whole words (geocoded Photon/Nominatim hits never do).
    const named = results.filter((a) => meansTyped(a, name) && nameMatch(a, name) !== null);
    // An exact code — but an ordinary word is not an unscheduled airport's ICAO code ("Lima" ≠ LIMA).
    const exact = results.find((a) => a.matchedBy !== undefined && EXACT_CODE.has(a.matchedBy) && (!wordNotCode(name) || a.scheduledService === true));
    if (exact) {
      const bearer = mainOf(
        named.filter((a) => a.matchedBy === 'fuzzy'),
        name,
      );
      const how = exactOrName(exact, bearer, name);
      if (how === 'exact' || !bearer) return { kind: 'found', code: codeOfHit(exact) };
      if (how === 'ask') return { kind: 'ambiguous', options: optionsOf([exact, bearer], name) };
    }
    const main = mainOf(named, name);
    if (main && isMainAirport(main, name)) {
      const far = farNamesakes(main, named, name);
      if (!far.length) return { kind: 'found', code: codeOfHit(main) };
      // The town of that name may have its own airport without scheduled service ("Cambridge":
      // Cambridge City, CBG): offered too, labelled as such, when the scheduled ones leave room.
      const scheduled = [...far.slice(0, MAX_OPTIONS - 1), main];
      const ownField =
        scheduled.length < MAX_OPTIONS ? mainOf(named.filter((a) => a.scheduledService === false && nameRank(a, name) >= NAME_RANK.town), name) : null;
      return { kind: 'ambiguous', options: optionsOf(ownField ? [...scheduled, ownField] : scheduled, name) };
    }
    if (main) return { kind: 'none', suggestion: suggestionOf(main, name, true) };
    const best = results[0];
    if (!best) return { kind: 'none' };
    const suggestion = suggestionOf(best, name, false);
    // Geocoded fallback: name the place and the distance (R4 m7).
    const geo = body.place;
    if (geo && typeof best.distanceKm === 'number' && (best.matchedBy === 'photon' || best.matchedBy === 'nominatim')) {
      suggestion.near = { place: [geo.name, geo.country].filter(Boolean).join(', '), source: geo.source, distanceKm: best.distanceKm };
    }
    return { kind: 'none', suggestion };
  } catch {
    return { kind: 'failed' };
  }
}

/**
 * From two typed names and their resolutions: the route to plan, or the draft to hand to PATHS
 * (pre-filled text + why it could not be planned + any suggestion). Exactly one of the two is
 * non-null. `metro` names the metro groups either name resolved through (also on the draft), so
 * PATHS can offer the group's other airports (round 10).
 */
export function routeOrDraft(
  from: string,
  to: string,
  a: PlaceResolution,
  b: PlaceResolution,
): { route: { from: string; to: string } | null; draft: Omit<PathsDraft, 'seq'> | null; metro?: NonNullable<PathsDraft['metro']> } {
  const groups = { ...(a.kind === 'found' && a.metro ? { from: a.metro } : {}), ...(b.kind === 'found' && b.metro ? { to: b.metro } : {}) };
  const metro = groups.from || groups.to ? groups : undefined;
  if (a.kind === 'found' && b.kind === 'found' && a.code !== b.code) return { route: { from: a.code, to: b.code }, draft: null, metro };
  const pick = (r: PlaceResolution, text: string) => (r.kind === 'found' ? r.code : text);
  const suggest = (r: PlaceResolution, side: DraftSuggestion['side'], text: string): DraftSuggestion[] => {
    switch (r.kind) {
      case 'none':
        return r.suggestion ? [{ ...r.suggestion, side, text }] : [];
      case 'ambiguous':
        return r.options.map((o) => ({ ...o, side, text }));
      case 'found':
      case 'failed':
        return [];
    }
  };
  const open = (r: PlaceResolution) => r.kind === 'none' || r.kind === 'ambiguous';
  return {
    route: null,
    draft: {
      from: pick(a, from),
      to: pick(b, to),
      unresolved: [open(a) && from, open(b) && to].filter((n): n is string => !!n),
      failed: [a.kind === 'failed' && from, b.kind === 'failed' && to].filter((n): n is string => !!n),
      same: a.kind === 'found' && b.kind === 'found' ? a.code : null,
      suggestions: [...suggest(a, 'from', from), ...suggest(b, 'to', to)],
      ...(metro ? { metro } : {}),
    },
    metro,
  };
}
