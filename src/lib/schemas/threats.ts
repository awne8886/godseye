/**
 * Threats & intel contracts. Owner: layers-threats-network.
 * Conflict zones are REFERENCE polygons; events inside them come only from GDELT or geoparsed
 * alerts, at their own coordinates. Never jitter events around zone anchors (OSIRIS did).
 */
import { z } from 'zod';
import { EntityBase, Envelope, IsoTime, Lat, Lng } from './common';

export const NuclearStatus = z.enum(['operational', 'under_construction', 'shutdown', 'decommissioned', 'planned', 'unknown']);

export const NuclearSite = EntityBase.extend({
  name: z.string(),
  country: z.string().nullable(),
  city: z.string().nullable(),
  status: NuclearStatus,
  operator: z.string().nullable(),
  reactors: z.number().int().nonnegative().nullable(),
  capacityMwe: z.number().nonnegative().nullable(),
  wikidataId: z.string().regex(/^Q\d+$/).nullable(),
  sourceUrl: z.url().nullable(),
  /** Context flags computed from live feeds with the method stated. */
  flags: z.array(
    z.object({
      kind: z.enum(['seismic', 'conflict']),
      label: z.string(),
      method: z.string(),
      observedAt: IsoTime,
    }),
  ),
});

export const InfrastructureResponse = Envelope.extend({ items: z.array(NuclearSite) });

export const GdacsIncident = EntityBase.extend({
  eventType: z.enum(['EQ', 'TC', 'FL', 'VO', 'DR', 'WF', 'OTHER']),
  title: z.string(),
  alertLevel: z.enum(['green', 'orange', 'red']).nullable(),
  country: z.string().nullable(),
  url: z.url().nullable(),
  fromDate: IsoTime.nullable(),
  toDate: IsoTime.nullable(),
});

export const GdacsResponse = Envelope.extend({ items: z.array(GdacsIncident) });

export const GdeltEvent = EntityBase.extend({
  globalEventId: z.string(),
  /**
   * GDELT DATEADDED (the 15-minute batch), ISO, capped at the batch's observed publish time: GDELT
   * labels batches ~10 min ahead of publication, and a time after the fetch is never served.
   * `observedAt` is the event's SQLDATE when parseable.
   */
  dateAdded: IsoTime,
  /** CAMEO QuadClass 1 verbal coop · 2 material coop · 3 verbal conflict · 4 material conflict. */
  quadClass: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  eventCode: z.string(),
  rootCode: z.string(),
  actor1: z.string().nullable(),
  actor2: z.string().nullable(),
  goldstein: z.number().min(-10).max(10).nullable(),
  avgTone: z.number().nullable(),
  numArticles: z.number().int().nonnegative(),
  numMentions: z.number().int().nonnegative(),
  numSources: z.number().int().nonnegative(),
  place: z.string().nullable(),
  countryCode: z.string().nullable(),
  /** GDELT ActionGeo_Type: 1 country, 2 US state, 3 US city, 4 world city, 5 world state. */
  geoPrecision: z.number().int().min(0).max(5),
  sourceUrl: z.url().nullable(),
});

export const GdeltEventsResponse = Envelope.extend({
  items: z.array(GdeltEvent).max(5_000),
  /**
   * 15-minute export windows aggregated, oldest → newest. `to` is the newest batch's observed
   * publish time (≤ fetch time); `latestLabel` is GDELT's own quarter-hour label for that batch,
   * which is usually later than its publication.
   */
  window: z.object({ from: IsoTime, to: IsoTime, batches: z.number().int().positive(), latestLabel: IsoTime.optional() }),
  /** Rows read before geo/quad filtering. */
  scanned: z.number().int().nonnegative(),
  /**
   * Geocoded events in the window that match the query (`quad`), before `limit`. When the window
   * held more than the feed keeps (5 000, newest first) this is the window's count for an
   * unfiltered query, so `items.length < total` always means not everything was served.
   */
  total: z.number().int().nonnegative().optional(),
  /** True when `items` is not every matching event in the window (`limit` or the feed's cap). */
  truncated: z.boolean().optional(),
});

export const ConflictZone = z.object({
  id: z.string(),
  label: z.string(),
  severity: z.enum(['war', 'high', 'elevated']),
  region: z.string(),
  /** Label anchor [lng, lat] (for the icon/label only; never used to place events). */
  anchor: z.tuple([Lng, Lat]),
  description: z.string(),
  polygon: z.custom<GeoJSON.Polygon | GeoJSON.MultiPolygon>(),
  /** Always 'reference' — zones are curated, not observed. */
  kind: z.literal('reference'),
  references: z.array(z.url()),
  /** Live events (GDELT/alerts) whose own coordinates fall inside the polygon in the last 24 h. */
  liveEventCount: z.number().int().nonnegative(),
});

/** A real event drawn inside/near zones, always at its own reported coordinates (never jittered). */
export const ConflictEvent = z.object({
  id: z.string(),
  lat: Lat,
  lng: Lng,
  title: z.string(),
  source: z.enum(['gdelt', 'alerts']),
  zoneId: z.string().nullable(),
  observedAt: IsoTime,
  url: z.url().nullable(),
  precision: z.enum(['settlement', 'region', 'country']),
});

export const ConflictsResponse = Envelope.extend({ zones: z.array(ConflictZone), events: z.array(ConflictEvent).max(500) });

export const FrontlinesResponse = Envelope.extend({
  geojson: z.custom<GeoJSON.FeatureCollection>(),
  asOf: IsoTime.nullable(),
});

export const CountryRisk = z.object({
  iso3: z.string().length(3),
  name: z.string(),
  score: z.number().nullable(),
  components: z.record(z.string(), z.number().nullable()),
  method: z.string(),
  sources: z.array(z.string()),
});

export const CountryRiskResponse = Envelope.extend({ items: z.array(CountryRisk) });
