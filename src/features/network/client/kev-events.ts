/**
 * CISA KEV newest additions → Intel Feed events (no coordinates: a vulnerability has no place).
 * CISA publishes `dateAdded` as a calendar date only, so the event time is that date at 00:00 UTC
 * and the title/detail say "date only" — no time of day is invented. Owner: layers-threats-network.
 */
import type { FeedEvent, KevEntry } from '@/lib/types';

/** Intel Feed layer key for KEV events (not a map layer). */
export const KEV_FEED_LAYER = 'cisa_kev';
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
    entityKind: 'threat_indicator' as const,
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
    observedAt: `${k.dateAdded}T00:00:00.000Z`,
    source: 'CISA KEV',
  }));
}
