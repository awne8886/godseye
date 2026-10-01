'use client';
/**
 * A typed-but-unresolved route handed to the PATHS panel (e.g. the command palette's "Plan route
 * LONDON → NEW YORK" when a name matched no airport): the panel pre-fills FROM/TO with the text and
 * tells the visitor which side found nothing, instead of the command failing silently (R4-m6).
 * A tiny external store (UI hand-off only, no data). Client-only.
 */
import { useSyncExternalStore } from 'react';

export interface PathsDraft {
  from: string;
  to: string;
  /** The typed names that resolved to no airport (the search answered with nothing). */
  unresolved: string[];
  /** The typed names whose airport search failed (network error / non-2xx): unknown, not "none". */
  failed?: string[];
  /** Both names resolved to this one airport (e.g. "London to Heathrow"). */
  same?: string | null;
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

/** The message shown in PATHS for a draft (round 3 m5: a failed search is not "no airport found"). */
export function draftMessage(d: Pick<PathsDraft, 'unresolved' | 'failed' | 'same'>): string | null {
  const parts: string[] = [];
  const q = (names: readonly string[]) => names.map((n) => `"${n}"`).join(' or ');
  if (d.failed?.length) parts.push(`Airport search did not answer for ${q(d.failed)} — try again, or type an airport code.`);
  if (d.unresolved.length) parts.push(`No airport found for ${q(d.unresolved)} — type a city, airport name or code and pick from the list.`);
  if (d.same) parts.push(`Both ends resolve to ${d.same} — pick a different airport for one end.`);
  return parts.length ? parts.join(' ') : null;
}

export type PlaceResolution = { kind: 'found'; code: string } | { kind: 'none' } | { kind: 'failed' };

/** One airport code for a place name via /api/airports/search: the metro group's first airport, else the best match. */
export async function resolvePlace(name: string, fetchImpl: typeof fetch = fetch): Promise<PlaceResolution> {
  try {
    const r = await fetchImpl(`/api/airports/search?q=${encodeURIComponent(name)}&submit=1`);
    if (!r.ok) return r.status === 404 ? { kind: 'none' } : { kind: 'failed' };
    const body = (await r.json()) as { results?: { iata: string | null; icao: string | null; ident: string }[]; metro?: { codes: string[] } | null };
    const metro = body.metro?.codes?.[0];
    if (metro) return { kind: 'found', code: metro };
    const a = body.results?.[0];
    return a ? { kind: 'found', code: a.iata ?? a.icao ?? a.ident } : { kind: 'none' };
  } catch {
    return { kind: 'failed' };
  }
}

/**
 * From two typed names and their resolutions: the route to plan, or the draft to hand to PATHS
 * (pre-filled text + why it could not be planned). Exactly one of the two is non-null.
 */
export function routeOrDraft(
  from: string,
  to: string,
  a: PlaceResolution,
  b: PlaceResolution,
): { route: { from: string; to: string } | null; draft: Omit<PathsDraft, 'seq'> | null } {
  if (a.kind === 'found' && b.kind === 'found' && a.code !== b.code) return { route: { from: a.code, to: b.code }, draft: null };
  const pick = (r: PlaceResolution, text: string) => (r.kind === 'found' ? r.code : text);
  return {
    route: null,
    draft: {
      from: pick(a, from),
      to: pick(b, to),
      unresolved: [a.kind === 'none' && from, b.kind === 'none' && to].filter((n): n is string => !!n),
      failed: [a.kind === 'failed' && from, b.kind === 'failed' && to].filter((n): n is string => !!n),
      same: a.kind === 'found' && b.kind === 'found' ? a.code : null,
    },
  };
}
