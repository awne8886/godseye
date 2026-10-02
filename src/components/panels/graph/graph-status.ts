/**
 * ENTITY GRAPH chip and status line. A failed expansion keeps the nodes of earlier expansions on
 * the canvas; the chip then names the failure (it used to keep reading "N NODES" in the error tone,
 * r8), and its tooltip says how many nodes are kept. Owner: panels-alerts-markets-dossier-graph.
 * Pure (tested).
 */
import type { ChipTone } from '@/components/hud/PanelChrome';
import { FeedOfflineError } from '../intel/client';
import { failureChip, failureText, queryFailure } from '../intel/query-state';

/** What a 503 from /api/entity/expand means. */
export const ENTITY_DOWN = 'no entity upstream answered';

export interface GraphFailure {
  /** The sentence under the canvas. */
  message: string;
  chip: { text: string; tone: ChipTone; title: string };
}

/** The verdict for a failed /api/entity/expand call (`e` is what getJson threw). */
export function graphFailure(e: unknown, now = Date.now()): GraphFailure {
  if (e instanceof FeedOfflineError && e.status === 400) {
    const message = 'Not a valid identifier for that type.';
    return { message, chip: { text: 'INVALID ID', tone: 'warn', title: message } };
  }
  // Anything else: a route status (503, 429, 5xx) or no answer at all (network error).
  const f = queryFailure({ data: undefined, error: e }) ?? { retained: false, status: null, lastGoodAt: null };
  return { message: failureText(f, ENTITY_DOWN, now), chip: failureChip(f, ENTITY_DOWN, now) };
}

export function graphChip(s: { busy: boolean; failure: GraphFailure | null }, nodeCount: number): { text: string; tone: ChipTone; title?: string } {
  if (s.busy) return { text: 'PLOTTING', tone: 'busy' };
  if (s.failure) {
    const kept = nodeCount ? ` ${nodeCount} node${nodeCount === 1 ? '' : 's'} kept from earlier expansions.` : '';
    return { ...s.failure.chip, title: `${s.failure.chip.title}${kept}` };
  }
  return nodeCount ? { text: `${nodeCount} NODES`, tone: 'live' } : { text: 'STANDBY', tone: 'idle' };
}
