'use client';
/**
 * Result of the last route/flight framing (round 3 M2, round 4 fix pass): RouteLayer records here
 * whether the route fits the viewport at the map's minimum zoom (if not, it is centred on its
 * visible hemisphere) and which endpoints, if any, sit under the HUD chrome at the framed camera
 * (a long route on a small phone), so the PATHS panel can say so. A tiny external store (UI
 * hand-off only, no data). Client-only.
 */
import { useSyncExternalStore } from 'react';

export interface FitNotice {
  /** `route:LHR-JFK` / `flight:BAW117` — the framed item. */
  key: string;
  fits: boolean;
  /** Endpoint codes whose dot or label is under an overlay (or off screen) as framed; empty when clear. */
  hidden?: readonly string[];
}

let current: FitNotice | null = null;
const listeners = new Set<() => void>();

const sameHidden = (a: readonly string[] = [], b: readonly string[] = []) => a.length === b.length && a.every((x, i) => x === b[i]);

export function setFitNotice(n: FitNotice | null): void {
  if (current?.key === n?.key && current?.fits === n?.fits && sameHidden(current?.hidden, n?.hidden)) return;
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

/** `data-fit` diagnostic: `full`, `full-obscured` (fits, but endpoint marks under chrome) or `partial`. */
export function fitState(n: FitNotice): 'full' | 'full-obscured' | 'partial' {
  if (!n.fits) return 'partial';
  return n.hidden?.length ? 'full-obscured' : 'full';
}

export const PARTIAL_FIT_TEXT = 'The whole route does not fit this screen at the lowest zoom — centred on its visible half; drag the globe to see the rest.';

/** PATHS line when the route fits but the named endpoints could not be kept clear of the map controls. */
export function obscuredFitText(hidden: readonly string[]): string {
  const one = hidden.length === 1;
  const names = one ? hidden[0]! : `${hidden.slice(0, -1).join(', ')} and ${hidden[hidden.length - 1]!}`;
  return `On this screen the ${names} ${one ? 'endpoint' : 'endpoints'} could not be kept clear of the map controls — drag or zoom the map to see ${one ? 'it' : 'them'}.`;
}
