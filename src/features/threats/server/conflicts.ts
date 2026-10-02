/**
 * Conflict zones: 15 curated REFERENCE polygons (Natural Earth admin/marine shapes, bundled in
 * public/data/zones.json) + live events that fall inside them. Owner: layers-threats-network.
 * Server-only.
 *
 * Honesty rules (OSIRIS jittered events around zone anchors; we never do):
 *  - Events come only from GDELT QuadClass 3/4 rows, drawn at their OWN ActionGeo coordinates, and
 *    from geoparsed Live Alerts (the news feed, read in-process) at their OWN pin coordinates.
 *  - Country-centroid geocodes (ActionGeo_Type 1, alert place precision 'country') are excluded: a
 *    country centroid says nothing about where inside a zone something happened.
 *  - `liveEventCount` counts events whose own point lies inside the polygon, over a rolling 24 h
 *    buffer built from the GDELT batches this process has seen (meta.note states the span).
 */
import 'server-only';
import { defineFeed, type FeedResult } from '@/lib/feeds';
import { pointInPolygon } from '@/lib/geo';
import { NEWS_ATTRIBUTION, newsFeed } from '@/components/panels/intel/feeds';
import type { AlertItem, ConflictEvent, ConflictZone, FreshnessState, GdeltEvent } from '@/lib/types';
import { gdeltTitle, precisionClass } from '../shared/gdelt';
import { GDELT_ATTRIBUTION, GDELT_CADENCE_MS, gdeltFeed, type GdeltData } from './gdelt';
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

export function toConflictEvent(e: GdeltEvent, zoneId: string | null, now = Date.now()): ConflictEvent {
  // dateAdded is already capped at the batch's observed publish time; never later than now either.
  const added = Date.parse(e.dateAdded);
  return {
    id: e.id,
    lat: e.lat,
    lng: e.lng,
    title: `${gdeltTitle(e)}${e.place ? ` · ${e.place}` : ''}`.slice(0, 240),
    source: 'gdelt',
    zoneId,
    observedAt: Number.isFinite(added) && added > now ? new Date(now).toISOString() : e.dateAdded,
    url: e.sourceUrl,
    precision: precisionClass(e.geoPrecision),
  };
}

const DAY_MS = 24 * 60 * 60_000;

/**
 * Live Alerts whose pin falls inside a zone, as conflict events at the pin's own coordinates.
 * Only settlement/region pins count (a country-level pin is a centroid, the same rule as GDELT
 * ActionGeo_Type 1); items without a place, outside every zone, with an unparseable time or older
 * than 24 h are dropped. observedAt is the author's publication time, capped at now. Pure.
 */
export function alertsToConflictEvents(items: readonly AlertItem[], zones: readonly ZoneRef[], boxes: readonly BBox[] = zones.map((z) => bboxOf(z.polygon)), now = Date.now()): ConflictEvent[] {
  const out: ConflictEvent[] = [];
  for (const it of items) {
    const p = it.place;
    if (!p || (p.precision !== 'settlement' && p.precision !== 'region')) continue;
    const published = Date.parse(it.publishedAt);
    if (!Number.isFinite(published) || now - published > DAY_MS) continue;
    const zoneId = zoneFor(zones, p.lng, p.lat, boxes as BBox[]);
    if (!zoneId) continue;
    out.push({
      id: `alert:${it.id}`,
      lat: p.lat,
      lng: p.lng,
      title: it.title.slice(0, 240),
      source: 'alerts',
      zoneId,
      observedAt: published > now ? new Date(now).toISOString() : new Date(published).toISOString(),
      url: it.link,
      precision: p.precision,
    });
  }
  return out;
}

/**
 * Merge new GDELT rows and in-zone Live Alerts into the rolling buffer (keyed by event id, alerts
 * as `alert:<id>`, pruned to 24 h by observedAt)
 * and return zones with counts plus the newest in-zone events (≤ 500). Pure; exported for tests.
 */
export function buildConflicts(zones: readonly ZoneRef[], buffer: Map<string, ConflictEvent>, incoming: readonly GdeltEvent[], now = Date.now(), alerts: readonly AlertItem[] = []) {
  const boxes = zones.map((z) => bboxOf(z.polygon));
  for (const ev of alertsToConflictEvents(alerts, zones, boxes, now)) buffer.set(ev.id, ev);
  for (const e of incoming) {
    if (e.quadClass !== 3 && e.quadClass !== 4) continue;
    if (e.geoPrecision === 1 || e.geoPrecision === 0) continue;
    const zoneId = zoneFor(zones, e.lng, e.lat, boxes);
    if (!zoneId) continue;
    buffer.set(e.id, toConflictEvent(e, zoneId, now));
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
  // Backstop for snapshot readers (/api/health): newest in-zone event older than an hour → STALE.
  maxObservationAgeMs: 60 * 60_000,
  // Never fresher than GDELT itself (also in /api/health); the route restates providers.gdelt.
  stateCap: (now) => gdeltCap(gdeltFeed.peek(), now),
  kind: 'mixed',
  attribution: [
    { text: 'Zone polygons: Natural Earth (public domain); zone list curated (REFERENCE)', url: 'https://www.naturalearthdata.com/' },
    ...GDELT_ATTRIBUTION,
    // Live Alert pins come from Telegram previews and wire RSS; credit them here too.
    ...NEWS_ATTRIBUTION,
  ],
  note: 'Zones are REFERENCE. Events are GDELT QuadClass 3/4 rows and geoparsed Live Alerts, each at its own point (country-level geocodes excluded); counts cover a rolling window of up to 24 h.',
  // Zones are always present; the feed is empty only if the bundled file is missing.
  count: (d) => d.zones.length,
  isEmpty: (d) => d.zones.length === 0,
  run: async () => {
    const zones = loadZones();
    // Both feeds are read in-process (never over HTTP); either may be offline without failing zones.
    const [g, n] = await Promise.all([gdeltFeed.get(), newsFeed.get()]);
    const newsOk = n.data !== null && (n.meta.state === 'live' || n.meta.state === 'recent');
    // Last-good GDELT data while GDELT is failing is not a success: only a fresh snapshot counts.
    const gdeltOk = g.data !== null && (g.meta.state === 'live' || g.meta.state === 'recent');
    if (g.data) {
      const from = Date.parse(g.data.window.from);
      if (!G.__godseyeConflictSince || from < G.__godseyeConflictSince) G.__godseyeConflictSince = Math.max(from, Date.now() - DAY_MS);
    }
    const built = buildConflicts(zones, buffer, g.data?.items ?? [], Date.now(), n.data?.items ?? []);
    const alertCount = built.events.filter((e) => e.source === 'alerts').length;
    const gdeltCount = built.events.length - alertCount;
    const newest = built.events[0] ? Date.parse(built.events[0].observedAt) : null;
    return {
      data: { ...built, since: G.__godseyeConflictSince ? new Date(G.__godseyeConflictSince).toISOString() : null },
      providers: {
        zones: { status: { ok: true, count: zones.length, ms: 0, age_s: 0 }, okAt: Date.now() },
        gdelt: {
          status: { ok: gdeltOk, count: gdeltCount, ms: 0, age_s: 0, ...(gdeltOk ? {} : { error: g.providers.export?.error ?? g.providers.lastupdate?.error ?? g.meta.state }) },
          okAt: g.data !== null && g.meta.fetchedAt ? Date.parse(g.meta.fetchedAt) : null,
        },
        alerts: {
          status: { ok: newsOk, count: alertCount, ms: 0, age_s: 0, ...(newsOk ? {} : { error: n.meta.state }) },
          okAt: n.data !== null && n.meta.fetchedAt ? Date.parse(n.meta.fetchedAt) : null,
        },
      },
      observedAt: newest,
    };
  },
});

const RANK: Record<Exclude<FreshnessState, 'reference'>, number> = { live: 0, recent: 1, stale: 2, offline: 3 };

/**
 * Conflicts is built from GDELT, so at response time it is never fresher than GDELT itself (R3
 * round-4 MINOR-1: it stayed LIVE for up to an hour while GDELT was down). When the GDELT feed is not
 * LIVE, the state follows the age of the last good GDELT pull at GDELT's 15-minute cadence: RECENT
 * up to 6 × 15 min, STALE after (the zones are REFERENCE and still served, so never OFFLINE here).
 * `providers.gdelt` is restated from the GDELT feed as it is now. A conflicts snapshot with no live
 * part (REFERENCE, GDELT never answered) is left as it is. Pure; exported for tests.
 */
/** The freshest state conflicts may claim given GDELT's own state (null = no cap). */
export function gdeltCap(g: FeedResult<GdeltData>, now = Date.now()): FreshnessState | null {
  const lastPull = Date.parse(g.meta.lastGoodAt ?? '');
  if (g.meta.state === 'live' || !Number.isFinite(lastPull)) return null;
  return Math.max(0, now - lastPull) <= 6 * GDELT_CADENCE_MS ? 'recent' : 'stale';
}

export function boundByGdelt(c: FeedResult<ConflictsData>, g: FeedResult<GdeltData>, now = Date.now()): FeedResult<ConflictsData> {
  if (c.data === null || c.meta.state === 'reference' || c.meta.state === 'offline') return c;
  const lastPull = Date.parse(g.meta.lastGoodAt ?? '');
  if (g.meta.state === 'live' || !Number.isFinite(lastPull)) return c;
  const ageMs = Math.max(0, now - lastPull);
  const cap: FreshnessState = ageMs <= 6 * GDELT_CADENCE_MS ? 'recent' : 'stale';
  const state = RANK[cap] > RANK[c.meta.state] ? cap : c.meta.state;
  const ok = g.meta.state === 'recent';
  const prev = c.providers.gdelt;
  return {
    ...c,
    meta: { ...c.meta, state, stale: c.meta.stale || state !== 'live' },
    providers: {
      ...c.providers,
      gdelt: {
        ok,
        count: prev?.count ?? c.data.events.filter((e) => e.source === 'gdelt').length,
        ms: prev?.ms ?? 0,
        age_s: Math.round(ageMs / 1000),
        ...(ok ? {} : { error: g.providers.export?.error ?? g.providers.lastupdate?.error ?? g.meta.state }),
      },
    },
  };
}

/** Test hook. */
export function resetConflictBuffer(): void {
  buffer.clear();
  G.__godseyeConflictSince = undefined;
}
