/**
 * Shared primitives and envelopes. Every /api JSON response is one of:
 *   - a FeedEnvelope subtype   (live or reference data; carries `meta` + `providers`)
 *   - a lookup result          (OSINT, airports, dossier; carries `providers` + `timestamp`)
 *   - ApiError                 ({error, detail?, code?, retryAfter?}) with a 4xx/5xx status
 *
 * Units are explicit in field names (…Ft, …Kt, …Km, …Nm, …Deg, …Ms, …S) wherever the
 * quantity is dimensional. Coordinates are WGS84 decimal degrees, `lng` in [-180, 180].
 * Times are ISO-8601 UTC strings with a trailing `Z`. Observation time (when the
 * upstream sensor/author saw the thing) is always kept separate from fetch time
 * (when GODSEYE's server pulled it). Never invent either.
 *
 * Validate with these schemas in tests and at trust boundaries (user input, small
 * upstream payloads). Do not zod-parse bulk arrays (flights, satellites, cameras) on hot paths.
 */
import { z } from 'zod';

/** ISO-8601 UTC timestamp, e.g. `2026-09-30T16:04:05Z` or with milliseconds. */
export const IsoTime = z.iso.datetime({ offset: false });
/**
 * Wall-clock time at a place WITH its UTC offset, e.g. `2026-09-30T18:29:00+01:00` (airport local
 * times, ETAs). Never send a local time without its offset: browsers parse that as their own zone.
 */
export const LocalTime = z.iso.datetime({ offset: true });
export const Lat = z.number().min(-90).max(90);
export const Lng = z.number().min(-180).max(180);
/** `[lng, lat]` in GeoJSON order. */
export const LngLat = z.tuple([Lng, Lat]);
/** `[west, south, east, north]`; west may exceed east when the box crosses the antimeridian. */
export const BBox = z.tuple([Lng, Lat, Lng, Lat]);

/** Per-upstream result reported by every aggregate response (§0.3). */
export const ProviderStatus = z.object({
  ok: z.boolean(),
  /** Records this provider contributed to the response (0 when it failed or was skipped). */
  count: z.number().int().nonnegative(),
  /** Wall-clock milliseconds of the last fetch attempt. */
  ms: z.number().nonnegative(),
  /** Age of the data this provider contributed, in seconds since it was fetched; null if never fetched. */
  age_s: z.number().nonnegative().nullable(),
  /** Short machine reason when not ok (e.g. `timeout`, `http_503`, `empty`, `parse`). */
  error: z.string().optional(),
  /** Why a provider did not run: missing key, licence gate, or disabled by config. */
  skipped: z.enum(['not-configured', 'licence', 'disabled', 'budget']).optional(),
});

export const Providers = z.record(z.string(), ProviderStatus);

export const Attribution = z.object({
  /** Display text, e.g. "Aircraft data © adsb.lol contributors, ODbL". */
  text: z.string(),
  url: z.url().optional(),
  licence: z.string().optional(),
});

/**
 * Honest data state of a feed or entity.
 * live      — refreshed within its expected cadence
 * recent    — older than cadence but younger than the stale threshold (badge shows age, e.g. "2m")
 * stale     — served from last-good after a failed refresh, or older than the stale threshold
 * offline   — no data could be obtained ("SOURCE OFFLINE" + last-good time)
 * reference — static/curated reference data (never shown as LIVE)
 */
export const FreshnessState = z.enum(['live', 'recent', 'stale', 'offline', 'reference']);

export const DataKind = z.enum(['live', 'reference', 'mixed']);

export const FeedMeta = z.object({
  /** Stable feed key, e.g. `flights`, `earthquakes`. */
  feed: z.string(),
  kind: DataKind,
  state: FreshnessState,
  /** When the server finished fetching the snapshot being served (null if it never succeeded). */
  fetchedAt: IsoTime.nullable(),
  /** Newest upstream observation time contained in the data (null for reference data or unknown). */
  observedAt: IsoTime.nullable(),
  /** Last time a refresh succeeded; equals fetchedAt unless the latest refresh failed. */
  lastGoodAt: IsoTime.nullable(),
  /** True when the snapshot is past its TTL or the last refresh failed. */
  stale: z.boolean(),
  ttlSeconds: z.number().int().positive(),
  attribution: z.array(Attribution),
  /** Optional human note, e.g. "US legs only", "historical (2014)". */
  note: z.string().optional(),
});

export const Envelope = z.object({
  meta: FeedMeta,
  providers: Providers,
});

export function feedResponse<T extends z.ZodType>(item: T) {
  return Envelope.extend({ items: z.array(item) });
}

/**
 * Columnar encoding for bulk layers (flights, satellites, cameras) so every /api
 * response stays under 4 MB uncompressed: `fields` names the tuple slots of each row.
 */
export const ColumnarCell = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export function columnarResponse(fields: readonly string[], maxRows = 50_000) {
  return Envelope.extend({
    fields: z
      .array(z.string())
      .refine((f) => f.length === fields.length && f.every((name, i) => name === fields[i]), {
        message: `fields must be exactly [${fields.join(', ')}]`,
      }),
    rows: z.array(z.array(ColumnarCell).length(fields.length)).max(maxRows),
  });
}

export const ApiError = z.object({
  error: z.string(),
  detail: z.string().optional(),
  code: z.string().optional(),
  /** Seconds until the client may retry (429/503). */
  retryAfter: z.number().int().nonnegative().optional(),
});

/** Base fields shared by every map entity rendered from a feed. */
export const EntityBase = z.object({
  /** Globally unique within its kind, stable across refreshes (e.g. ICAO hex, NORAD id, USGS id). */
  id: z.string().min(1),
  lat: Lat,
  lng: Lng,
  /** When the upstream observed/published this record; null only for reference entities. */
  observedAt: IsoTime.nullable(),
  /** Provider key from the feed's `providers` map that supplied this record. */
  source: z.string(),
});

export const EntityKind = z.enum([
  'aircraft',
  'vessel',
  'port',
  'chokepoint',
  'satellite',
  'camera',
  'news_channel',
  'earthquake',
  'fire',
  'weather_event',
  'air_quality',
  'gps_jam_cell',
  'sentinel_scene',
  'nuclear_site',
  'gdacs_incident',
  'alert',
  'gdelt_event',
  'conflict_zone',
  'frontline',
  'country_risk',
  'malware_host',
  'c2_server',
  'threat_indicator',
  'outage',
  'attack_origin',
  'cable',
  'landing_point',
  'airport',
  'region',
]);

/** One Intel Feed row emitted by a layer's feed-event mapper. */
export const FeedEvent = z.object({
  /** Unique within its layer (the store dedupes on layer + id): `${entityId}` or `${entityId}:${revision}`. */
  id: z.string(),
  layer: z.string(),
  entityKind: EntityKind,
  entityId: z.string(),
  title: z.string(),
  detail: z.string().optional(),
  severity: z.enum(['info', 'low', 'medium', 'high', 'critical']),
  observedAt: IsoTime,
  lat: Lat.optional(),
  lng: Lng.optional(),
  source: z.string(),
});

export const Paged = z.object({
  total: z.number().int().nonnegative(),
  truncated: z.boolean(),
});
