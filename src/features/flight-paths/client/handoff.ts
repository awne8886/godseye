'use client';
/**
 * Hand-offs into the Flight Path Planner from outside PATHS (aircraft card, command palette).
 * Round 10 MAJOR 1: tracking a flight with a route already planned must replace the route, as
 * PATHS's own TRACK does — RouteLayer draws the flight only while no route is planned, and PATHS
 * shows the FLIGHT tab when `flightIdent` changes. One store update, so the URL never holds both.
 * Client-only.
 */
import { useUiStore } from '@/lib/store';
import { setPathsDraft, type PathsDraft } from './draft';

/** Track `ident` in PATHS: clears the planned route and any pending draft, opens PATHS. */
export function trackFlight(ident: string): void {
  setPathsDraft(null);
  useUiStore.setState({ plannedRoute: null, flightIdent: ident });
  useUiStore.getState().setOpenPanel('paths');
}

/** Plan `from`→`to` in PATHS (clears a tracked flight); `metro` lists each end's metro airports as chips. */
export function planRoute(route: { from: string; to: string }, metro?: PathsDraft['metro']): void {
  setPathsDraft(metro ? { from: route.from, to: route.to, unresolved: [], metro } : null);
  useUiStore.setState({ flightIdent: null, plannedRoute: route });
  useUiStore.getState().setOpenPanel('paths');
}
