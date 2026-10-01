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
  /** The typed names that resolved to no airport. */
  unresolved: string[];
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

/** The message shown in PATHS for a draft. */
export function draftMessage(d: Pick<PathsDraft, 'unresolved'>): string | null {
  if (!d.unresolved.length) return null;
  return `No airport found for ${d.unresolved.map((n) => `"${n}"`).join(' or ')} — type a city, airport name or code and pick from the list.`;
}
