/**
 * Conflict zones: 15 curated REFERENCE polygons (Natural Earth admin/marine shapes, bundled in
 * public/data/zones.json) + live events that fall inside them. Owner: layers-threats-network.
 * Server-only.
 *
 * Honesty rules (OSIRIS jittered events around zone anchors; we never do):
 *  - Events come only from GDELT QuadClass 3/4 rows, drawn at their OWN ActionGeo coordinates.
 *  - Country-centroid geocodes (ActionGeo_Type 1) are excluded: a country centroid says nothing
 *    about where inside a zone something happened.
 *  - `liveEventCount` counts events whose own point lies inside the polygon, over a rolling 24 h
 *    buffer built from the GDELT batches this process has seen (meta.note states the span).
 */
import 'server-only';
import { defineFeed } from '@/lib/feeds';
import { pointInPolygon } from '@/lib/geo';
import type { ConflictEvent, ConflictZone, GdeltEvent } from '@/lib/types';
import { gdeltTitle, precisionClass } from '../shared/gdelt';
import { GDELT_ATTRIBUTION, gdeltFeed } from './gdelt';
import { readRef } from './refdata';

type ZoneRef = Omit<ConflictZone, 'liveEventCount'>;
export interface ZonesFile {
  _meta: Record<string, unknown>;
  zones: ZoneRef[];
}

export function loadZones(): ZoneRef[] {
  return readRef<ZonesFile>('zones.json').zones;
}

type BBox = [number, number, number, number];
function bboxOf(poly: GeoJSON.Polygon | GeoJSON.MultiPolygon): BBox {
  const b: BBox = [180, 90, -180, -90];
  const rings = poly.type === 'Polygon' ? poly.coordinates : poly.coordinates.flat();
  for (const ring of rings)
    for (const [x, y] of ring) {
      if (x! < b[0]) b[0] = x!;
      if (y! < b[1]) b[1] = y!;
      if (x! > b[2]) b[2] = x!;
      if (y! > b[3]) b[3] = y!;
    }
  return b;
}

/** The zone whose polygon contains the point, or null. Pure; exported for tests. */
export function zoneFor(zones: readonly ZoneRef[], lng: number, lat: number, boxes = zones.map((z) => bboxOf(z.polygon))): string | null {
  for (let i = 0; i < zones.length; i++) {
    const b = boxes[i]!;
    if (lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3]) continue;
    if (pointInPolygon([lng, lat], zones[i]!.polygon)) return zones[i]!.id;
  }
  return null;
}

export function toConflictEvent(e: GdeltEvent, zoneId: string | null): ConflictEvent {
  return {
    id: e.id,
    lat: e.lat,
    lng: e.lng,
    title: `${gdeltTitle(e)}${e.place ? ` · ${e.place}` : ''}`.slice(0, 240),
    source: 'gdelt',
    zoneId,
    observedAt: e.dateAdded,
    url: e.sourceUrl,
    precision: precisionClass(e.geoPrecision),
  };
}

const DAY_MS = 24 * 60 * 60_000;

/**
 * Merge new GDELT rows into the rolling buffer (keyed by event id, pruned to 24 h by dateAdded)
 * and return zones with counts plus the newest in-zone events (≤ 500). Pure; exported for tests.
 */
export function buildConflicts(zones: readonly ZoneRef[], buffer: Map<string, ConflictEvent>, incoming: readonly GdeltEvent[], now = Date.now()) {
  const boxes = zones.map((z) => bboxOf(z.polygon));
  for (const e of incoming) {
    if (e.quadClass !== 3 && e.quadClass !== 4) continue;
    if (e.geoPrecision === 1 || e.geoPrecision === 0) continue;
    const zoneId = zoneFor(zones, e.lng, e.lat, boxes);
    if (!zoneId) continue;
    buffer.set(e.id, toConflictEvent(e, zoneId));
  }
  for (const [id, ev] of buffer) if (now - Date.parse(ev.observedAt) > DAY_MS) buffer.delete(id);
  const counts = new Map<string, number>();
  for (const ev of buffer.values()) counts.set(ev.zoneId!, (counts.get(ev.zoneId!) ?? 0) + 1);
  const events = [...buffer.values()].sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt)).slice(0, 500);
  return { zones: zones.map((z) => ({ ...z, liveEventCount: counts.get(z.id) ?? 0 })), events };
}

const G = globalThis as unknown as { __godseyeConflictBuffer?: Map<string, ConflictEvent>; __godseyeConflictSince?: number };
const buffer = (G.__godseyeConflictBuffer ??= new Map());

export interface ConflictsData {
  zones: ConflictZone[];
  events: ConflictEvent[];
  /** Earliest GDELT batch folded into the counts (the buffer grows to 24 h after boot). */
  since: string | null;
}

export const conflictsFeed = defineFeed<ConflictsData>({
  key: 'conflicts',
  ttlMs: 15 * 60_000,
  pollMs: 5 * 60_000,
  kind: 'mixed',
  attribution: [
    { text: 'Zone polygons: Natural Earth (public domain); zone list curated (REFERENCE)', url: 'https://www.naturalearthdata.com/' },
    ...GDELT_ATTRIBUTION,
  ],
  note: 'Zones are REFERENCE. Events are GDELT QuadClass 3/4 rows at their own geocoded points (country-level geocodes excluded); counts cover a rolling window of up to 24 h.',
  // Zones are always present; the feed is empty only if the bundled file is missing.
  count: (d) => d.zones.length,
  isEmpty: (d) => d.zones.length === 0,
  run: async () => {
    const zones = loadZones();
    const g = await gdeltFeed.get();
    const gdeltOk = g.data !== null;
    if (g.data) {
      const from = Date.parse(g.data.window.from);
      if (!G.__godseyeConflictSince || from < G.__godseyeConflictSince) G.__godseyeConflictSince = Math.max(from, Date.now() - DAY_MS);
    }
    const built = buildConflicts(zones, buffer, g.data?.items ?? []);
    const newest = built.events[0] ? Date.parse(built.events[0].observedAt) : null;
    return {
      data: { ...built, since: G.__godseyeConflictSince ? new Date(G.__godseyeConflictSince).toISOString() : null },
      providers: {
        zones: { status: { ok: true, count: zones.length, ms: 0, age_s: 0 }, okAt: Date.now() },
        gdelt: {
          status: { ok: gdeltOk, count: built.events.length, ms: 0, age_s: 0, ...(gdeltOk ? {} : { error: g.providers.export?.error ?? g.providers.lastupdate?.error ?? 'offline' }) },
          okAt: gdeltOk && g.meta.fetchedAt ? Date.parse(g.meta.fetchedAt) : null,
        },
      },
      observedAt: newest,
    };
  },
});

/** Test hook. */
export function resetConflictBuffer(): void {
  buffer.clear();
  G.__godseyeConflictSince = undefined;
}
