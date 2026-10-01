/**
 * CISA KEV newest additions → Intel Feed events (no coordinates: a vulnerability has no place).
 * CISA publishes `dateAdded` as a calendar date only. FeedEvent.observedAt must be an instant, so it
 * carries that date at 00:00 UTC purely as a sort key; the Intel Feed marks this layer date-precision
 * (`KEV_TIME_PRECISION`) and renders the date, never an age or a time of day, and the detail says
 * "date only". Owner: layers-threats-network.
 */
import type { FeedEvent, KevEntry } from '@/lib/types';

/** Intel Feed layer key for KEV events (not a map layer). */
export const KEV_FEED_LAYER = 'cisa_kev';
/** Human label for the layer column / filter (the id is not a map layer). */
export const KEV_FEED_LABEL = 'CISA KEV';
/** KEV event times are calendar dates only. */
export const KEV_TIME_PRECISION = 'date' as const;
/** How many of the newest KEV additions are published to the Intel Feed. */
export const KEV_FEED_LIMIT = 20;

function severityOf(k: KevEntry): FeedEvent['severity'] {
  if (k.ransomware === 'Known' || (k.cvssScore ?? 0) >= 9) return 'high';
  return 'medium';
}

export function kevEvents(items: readonly KevEntry[]): FeedEvent[] {
  return items.map((k) => ({
    id: k.cveId,
    layer: KEV_FEED_LAYER,
    // EntityKind has no 'vulnerability' yet (lead-owned enum); KEV rows carry no coordinates and
    // open no card, so the kind is metadata only.
    entityKind: 'vulnerability' as const,
    entityId: k.cveId,
    title: `CISA KEV added ${k.cveId}: ${[k.vendor, k.product].filter(Boolean).join(' ') || k.name}`,
    detail: [
      k.name,
      `added ${k.dateAdded} (date only)`,
      k.dueDate ? `federal due date ${k.dueDate}` : null,
      k.ransomware === 'Known' ? 'known ransomware use' : null,
      typeof k.cvssScore === 'number' ? `CVSS ${k.cvssVersion ?? ''} ${k.cvssScore}`.replace('  ', ' ') : null,
    ]
      .filter(Boolean)
      .join(' · '),
    severity: severityOf(k),
    observedAt: `${k.dateAdded}T00:00:00.000Z`, // sort key only: date precision (see header)
    source: 'CISA KEV',
  }));
}
