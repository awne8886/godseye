'use client';
/**
 * Result of the last globe framing (round 3 M2): when a route cannot fit the viewport even at the
 * map's minimum zoom, RouteLayer centres it on its visible hemisphere and records that here so the
 * PATHS panel can say the ends may be off-screen. A tiny external store (UI hand-off only, no
 * data). Client-only.
 */
import { useSyncExternalStore } from 'react';

export interface FitNotice {
  /** `route:LHR-JFK` / `flight:BAW117` — the framed item. */
  key: string;
  fits: boolean;
}

let current: FitNotice | null = null;
const listeners = new Set<() => void>();

export function setFitNotice(n: FitNotice | null): void {
  if (current?.key === n?.key && current?.fits === n?.fits) return;
  current = n;
  for (const l of listeners) l();
}

export function getFitNotice(): FitNotice | null {
  return current;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useFitNotice(): FitNotice | null {
  return useSyncExternalStore(subscribe, getFitNotice, () => null);
}

export const PARTIAL_FIT_TEXT = 'The whole route does not fit this screen at the lowest zoom — centred on its visible half; drag the globe to see the rest.';
