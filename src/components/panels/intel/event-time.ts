/**
 * Intel Feed row time and layer label. Most layers publish an observed instant (shown as an age);
 * some feed-only sources publish a calendar date only (CISA KEV `dateAdded`): the event's
 * `observedAt` is then just a sort key at 00:00 UTC, so the row shows the date and never an age or a
 * time of day. Pure (tested). Owner: panels-alerts-markets-dossier-graph.
 */
import { formatAge } from '@/lib/freshness';
import { LAYERS } from '@/lib/layer-registry';
import type { FeedEvent } from '@/lib/types';
import { KEV_FEED_LABEL, KEV_FEED_LAYER, KEV_TIME_PRECISION } from '@/features/network/client/kev-events';

/** Feed-only event layers (not map layers): label and the precision of their event times. */
export const FEED_ONLY_LAYERS: Readonly<Record<string, { label: string; precision: 'date' | 'instant' }>> = {
  [KEV_FEED_LAYER]: { label: KEV_FEED_LABEL, precision: KEV_TIME_PRECISION },
};

export function eventLayerLabel(id: string): string {
  return FEED_ONLY_LAYERS[id]?.label ?? (LAYERS as readonly { id: string; label: string }[]).find((l) => l.id === id)?.label ?? id;
}

/** `text` for the row's time column and `title` for its tooltip. */
export function eventTime(e: Pick<FeedEvent, 'layer' | 'observedAt'>, now: number): { text: string; title: string } {
  if (FEED_ONLY_LAYERS[e.layer]?.precision === 'date') {
    const day = e.observedAt.slice(0, 10);
    return { text: day, title: `${day} (date only; the source publishes no time of day)` };
  }
  return { text: `${formatAge(now - Date.parse(e.observedAt))} ago`, title: e.observedAt };
}

/**
 * INTEL FEED header chip. The store keeps the events a layer published even after that layer's
 * feed fails, so a count alone would read green beside offline layers (r8). The chip is toned by the
 * state of the layers that published the events: all of them offline → SOURCE OFFLINE (error);
 * some offline or stale → the count in the warning tone, naming them; otherwise the count, live.
 * Feed-only layers (no map layer, no rail status) do not change the tone.
 */
export function feedChip(shown: number, publishing: readonly string[], stateOf: (layer: string) => string | undefined): { text: string; tone: 'idle' | 'live' | 'warn' | 'error'; title?: string } {
  if (!publishing.length) return { text: 'STANDBY', tone: 'idle' };
  const known = publishing.filter((l) => stateOf(l) !== undefined);
  const offline = known.filter((l) => stateOf(l) === 'offline');
  const stale = known.filter((l) => stateOf(l) === 'stale');
  const names = (ls: readonly string[]) => ls.map(eventLayerLabel).join(', ');
  if (known.length > 0 && offline.length === known.length) {
    return { text: 'SOURCE OFFLINE', tone: 'error', title: `Source offline: ${names(offline)}. ${shown} rows are the last copy received.` };
  }
  if (offline.length || stale.length) {
    const parts = [offline.length ? `source offline: ${names(offline)}` : '', stale.length ? `stale: ${names(stale)}` : ''].filter(Boolean);
    return { text: `${shown} RESULTS`, tone: 'warn', title: `${shown} results; ${parts.join('; ')}.` };
  }
  return { text: `${shown} RESULTS`, tone: 'live' };
}
