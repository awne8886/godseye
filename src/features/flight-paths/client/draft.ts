'use client';
/**
 * A typed-but-unresolved route handed to the PATHS panel (e.g. the command palette's "Plan route
 * LONDON → NEW YORK" when a name matched no airport): the panel pre-fills FROM/TO with the text and
 * tells the visitor which side found nothing, instead of the command failing silently (R4-m6).
 * Round 4 M2: the search always answers with fuzzy or geocoded candidates ("Atlantis" → ACY), so a
 * candidate is planned only when the name actually means it; otherwise the draft offers it as
 * "Did you mean ACY (Atlantic City)?" with a one-click accept.
 * A tiny external store (UI hand-off only, no data). Client-only.
 */
import { useSyncExternalStore } from 'react';

/** The search's best candidate for a name that did not resolve to an airport by itself. */
export interface PlaceSuggestion {
  code: string;
  /** Municipality, else the airport name. */
  label: string;
}

/** A suggestion attached to one end of a draft. */
export interface DraftSuggestion extends PlaceSuggestion {
  side: 'from' | 'to';
  /** The text the visitor typed for that end. */
  text: string;
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
  /** Best candidates for unresolved names, offered with a one-click accept (never planned silently). */
  suggestions?: DraftSuggestion[];
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

/** "Did you mean ACY (Atlantic City)?" */
export const suggestionText = (s: PlaceSuggestion): string => `Did you mean ${s.code} (${s.label})?`;

/** The message shown in PATHS for a draft (round 3 m5: a failed search is not "no airport found"). */
export function draftMessage(d: Pick<PathsDraft, 'unresolved' | 'failed' | 'same' | 'suggestions'>): string | null {
  const parts: string[] = [];
  const q = (names: readonly string[]) => names.map((n) => `"${n}"`).join(' or ');
  if (d.failed?.length) parts.push(`Airport search did not answer for ${q(d.failed)} — try again, or type an airport code.`);
  const suggested = new Map((d.suggestions ?? []).map((s) => [s.text, s]));
  for (const name of d.unresolved) {
    const s = suggested.get(name);
    if (s) parts.push(`No airport named "${name}". ${suggestionText(s)}`);
  }
  const bare = d.unresolved.filter((n) => !suggested.has(n));
  if (bare.length) parts.push(`No airport found for ${q(bare)} — type a city, airport name or code and pick from the list.`);
  if (d.same) parts.push(`Both ends resolve to ${d.same} — pick a different airport for one end.`);
  return parts.length ? parts.join(' ') : null;
}

export type PlaceResolution = { kind: 'found'; code: string } | { kind: 'none'; suggestion?: PlaceSuggestion | null } | { kind: 'failed' };

interface SearchHit {
  iata: string | null;
  icao: string | null;
  ident: string;
  name?: string | null;
  municipality?: string | null;
  keywords?: string | null;
  matchedBy?: string;
}

/** Case-, accent- and whitespace-folded text for containment tests ("Zürich" ≡ "zurich"). */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const EXACT: ReadonlySet<string> = new Set(['metro', 'iata', 'icao', 'ident']);

/**
 * Does this hit mean what was typed? An exact code or metro match always does; a fuzzy hit only
 * when its name, municipality or keywords contain the typed text (folded). Geocoded
 * (Photon/Nominatim → nearest airport) hits never do: they are suggestions.
 */
export function meansTyped(hit: SearchHit, typed: string): boolean {
  if (hit.matchedBy !== undefined && EXACT.has(hit.matchedBy)) return true;
  if (hit.matchedBy !== 'fuzzy') return false;
  const t = fold(typed);
  if (!t) return false;
  return [hit.name, hit.municipality, hit.keywords].some((f) => !!f && fold(f).includes(t));
}

const codeOfHit = (a: SearchHit) => a.iata ?? a.icao ?? a.ident;

/**
 * One airport code for a place name via /api/airports/search: the metro group's first airport,
 * else the best hit the name actually means (`meansTyped`); otherwise `none` with the best
 * candidate as a suggestion (round 4 M2: "Atlantis" is not ACY).
 */
export async function resolvePlace(name: string, fetchImpl: typeof fetch = fetch): Promise<PlaceResolution> {
  try {
    const r = await fetchImpl(`/api/airports/search?q=${encodeURIComponent(name)}&submit=1`);
    if (!r.ok) return r.status === 404 ? { kind: 'none' } : { kind: 'failed' };
    const body = (await r.json()) as { results?: SearchHit[]; metro?: { codes: string[] } | null };
    const metro = body.metro?.codes?.[0];
    if (metro) return { kind: 'found', code: metro };
    const results = body.results ?? [];
    const hit = results.find((a) => meansTyped(a, name));
    if (hit) return { kind: 'found', code: codeOfHit(hit) };
    const best = results[0];
    return best ? { kind: 'none', suggestion: { code: codeOfHit(best), label: best.municipality || best.name || codeOfHit(best) } } : { kind: 'none' };
  } catch {
    return { kind: 'failed' };
  }
}

/**
 * From two typed names and their resolutions: the route to plan, or the draft to hand to PATHS
 * (pre-filled text + why it could not be planned + any suggestion). Exactly one of the two is
 * non-null.
 */
export function routeOrDraft(
  from: string,
  to: string,
  a: PlaceResolution,
  b: PlaceResolution,
): { route: { from: string; to: string } | null; draft: Omit<PathsDraft, 'seq'> | null } {
  if (a.kind === 'found' && b.kind === 'found' && a.code !== b.code) return { route: { from: a.code, to: b.code }, draft: null };
  const pick = (r: PlaceResolution, text: string) => (r.kind === 'found' ? r.code : text);
  const suggest = (r: PlaceResolution, side: DraftSuggestion['side'], text: string): DraftSuggestion[] => {
    switch (r.kind) {
      case 'none':
        return r.suggestion ? [{ ...r.suggestion, side, text }] : [];
      case 'found':
      case 'failed':
        return [];
    }
  };
  return {
    route: null,
    draft: {
      from: pick(a, from),
      to: pick(b, to),
      unresolved: [a.kind === 'none' && from, b.kind === 'none' && to].filter((n): n is string => !!n),
      failed: [a.kind === 'failed' && from, b.kind === 'failed' && to].filter((n): n is string => !!n),
      same: a.kind === 'found' && b.kind === 'found' ? a.code : null,
      suggestions: [...suggest(a, 'from', from), ...suggest(b, 'to', to)],
    },
  };
}
