/**
 * Selections for curated records whose ids we mint ourselves from a name: conflict zones
 * ("ukraine"), chokepoints ("choke-bab-el-mandeb") and curated ports ("port-shanghai"). The card
 * frame prints `selection.id` on the line under the entity kind, so these selections carry the
 * record's display name there (the curated zone label, the chokepoint/port name) instead of an
 * internal slug. Upstream identifiers stay as they are: WPI index, Natural Earth ne_id, MMSI,
 * GDELT GLOBALEVENTID. Pure; owner: layers-threats-network.
 */
import type { Selection } from '@/lib/layer-host';
import type { Chokepoint, ConflictEvent, ConflictZone, Port } from '@/lib/types';

/** Card data for an in-zone GDELT event: the record plus its zone's display name (never the zone id). */
export type ConflictEventCardData = ConflictEvent & { zoneLabel: string | null };

const record = <T extends object>(t: T) => t as unknown as Record<string, unknown>;

/** The display name of a curated zone: its curated label ("UKRAINE WAR"). */
export const zoneDisplayName = (z: Pick<ConflictZone, 'label'>): string => z.label.trim();

export function zoneSelection(z: ConflictZone): Selection {
  return { kind: 'conflict_zone', id: zoneDisplayName(z), layer: 'conflict_zones', source: 'curated', observedAt: null, data: record(z), lngLat: z.anchor };
}

/** An in-zone event keeps its GDELT event id; its card names the zone it falls in by display name. */
export function conflictEventSelection(e: ConflictEvent, zone: Pick<ConflictZone, 'label'> | undefined): Selection {
  const data: ConflictEventCardData = { ...e, zoneLabel: zone ? zoneDisplayName(zone) : null };
  return { kind: 'conflict_zone', id: e.id, layer: 'conflict_zones', source: 'gdelt', observedAt: e.observedAt, data: record(data), lngLat: [e.lng, e.lat] };
}

export function chokepointSelection(c: Chokepoint): Selection {
  return { kind: 'chokepoint', id: c.name, layer: 'maritime', source: 'curated', observedAt: null, data: record(c), lngLat: [c.lng, c.lat] };
}

/** Curated ports are named by their name; WPI and Natural Earth ports keep the upstream index. */
export function portSelection(p: Port): Selection {
  return { kind: 'port', id: p.dataset === 'curated' ? p.name : p.id, layer: 'maritime', source: p.source, observedAt: null, data: record(p), lngLat: [p.lng, p.lat] };
}
