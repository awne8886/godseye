'use client';
/**
 * Hand-offs into the Flight Path Planner from outside PATHS (aircraft card, command palette).
 * Round 10 MAJOR 1: tracking a flight with a route already planned must replace the route, as
 * PATHS's own TRACK does — RouteLayer draws the flight only while no route is planned, and PATHS
 * shows the FLIGHT tab on every hand-off. One store update, so the URL never holds both.
 * Round 11: each hand-off bumps a sequence number (as `draft.seq` does), so tracking the ident that is
 * already tracked still brings PATHS back to FLIGHT after the visitor picked LIVE or ROUTE.
 * Client-only.
 */
import { useSyncExternalStore } from 'react';
import { useUiStore } from '@/lib/store';
import { setPathsDraft, type PathsDraft } from './draft';

let trackSeq = 0;
const listeners = new Set<() => void>();

const getTrackSeq = (): number => trackSeq;

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Increments per `trackFlight` hand-off, so the same ident twice still re-applies. */
export function useTrackSeq(): number {
  return useSyncExternalStore(subscribe, getTrackSeq, () => 0);
}

/** Track `ident` in PATHS: clears the planned route and any pending draft, opens PATHS on FLIGHT. */
export function trackFlight(ident: string): void {
  setPathsDraft(null);
  useUiStore.setState({ plannedRoute: null, flightIdent: ident });
  trackSeq += 1;
  for (const l of listeners) l();
  useUiStore.getState().setOpenPanel('paths');
}

/** Plan `from`→`to` in PATHS (clears a tracked flight); `metro` lists each end's metro airports as chips. */
export function planRoute(route: { from: string; to: string }, metro?: PathsDraft['metro']): void {
  setPathsDraft(metro ? { from: route.from, to: route.to, unresolved: [], metro } : null);
  useUiStore.setState({ flightIdent: null, plannedRoute: route });
  useUiStore.getState().setOpenPanel('paths');
}
