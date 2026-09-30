/**
 * Network intel contracts. Owner: layers-threats-network.
 * Blocklist indicators (Feodo, ThreatFox) render as points labelled INDICATOR. Attack arcs are
 * drawn only from real, attributed telemetry that names both ends; Cloudflare Radar's
 * `/attacks/layer3/top/locations/origin` gives origin SHARES only, so it renders as origin points
 * (no fabricated targets) unless `targetCountryCode` is reported.
 * Geolocated IPs carry `geoPrecision` because an IP's position is approximate by nature.
 */
import { z } from 'zod';
import { EntityBase, Envelope, IsoTime, Lat, Lng } from './common';

export const GeoPrecision = z.enum(['city', 'region', 'country-centroid']);

export const MalwareHost = EntityBase.extend({
  /** The IP (hosts are keyed by IP). */
  ip: z.string(),
  port: z.number().int().min(0).max(65535).nullable(),
  threat: z.string(),
  family: z.string().nullable(),
  urlCount: z.number().int().positive(),
  online: z.boolean(),
  asn: z.string().nullable(),
  country: z.string().nullable(),
  city: z.string().nullable(),
  geoPrecision: GeoPrecision,
  urlhausReference: z.url().nullable(),
  firstSeen: IsoTime.nullable(),
});

export const MalwareResponse = Envelope.extend({
  items: z.array(MalwareHost),
  /** Distinct IP hosts in the URLhaus window, and how many are still awaiting geolocation. */
  hostsTotal: z.number().int().nonnegative().optional(),
  pendingGeo: z.number().int().nonnegative().optional(),
});

/** SSE payloads on /api/malware/stream (event names: snapshot | detections | status | heartbeat). */
export const MalwareStreamStatus = z.object({ retired: z.array(z.string()), total: z.number().int(), at: IsoTime });

export const C2Server = EntityBase.extend({
  ip: z.string(),
  port: z.number().int().nullable(),
  malware: z.string().nullable(),
  status: z.enum(['online', 'offline']),
  asn: z.string().nullable(),
  asName: z.string().nullable(),
  country: z.string().nullable(),
  hostname: z.string().nullable(),
  firstSeen: IsoTime.nullable(),
  /** Feodo publishes a date only; normalised to 00:00:00Z of that date and labelled date-only in the UI. */
  lastOnline: IsoTime.nullable(),
  lastOnlineDateOnly: z.boolean(),
  geoPrecision: GeoPrecision,
  label: z.literal('INDICATOR'),
});

export const C2Response = Envelope.extend({
  items: z.array(C2Server),
  /** How many listed C2s Feodo Tracker currently marks online (may honestly be 0 or 1). */
  onlineCount: z.number().int().nonnegative().optional(),
  /** Listed C2s not drawn because they could not be geolocated this run. */
  unlocated: z.number().int().nonnegative().optional(),
});

/**
 * ThreatFox IOC. Most IOCs (domains, URLs, hashes) have no location: they live in the panel list.
 * Only IP IOCs that could be geolocated carry `geo` and are drawn as INDICATOR points.
 * Attacker domains are never DNS-resolved by the server.
 */
export const ThreatIndicator = z.object({
  id: z.string(),
  threatfoxId: z.string(),
  ioc: z.string(),
  iocType: z.string(),
  threatType: z.string(),
  malware: z.string().nullable(),
  confidence: z.number().int().min(0).max(100).nullable(),
  tags: z.array(z.string()),
  firstSeen: IsoTime.nullable(),
  observedAt: IsoTime.nullable(),
  reference: z.url().nullable(),
  source: z.string(),
  geo: z.object({ lat: Lat, lng: Lng, precision: GeoPrecision, country: z.string().nullable() }).nullable(),
  label: z.literal('INDICATOR'),
});

export const ThreatFoxResponse = Envelope.extend({ items: z.array(ThreatIndicator), located: z.number().int().nonnegative() });

export const KevEntry = z.object({
  cveId: z.string().regex(/^CVE-\d{4}-\d{4,}$/),
  vendor: z.string(),
  product: z.string(),
  name: z.string(),
  dateAdded: z.iso.date(),
  dueDate: z.iso.date().nullable(),
  ransomware: z.enum(['Known', 'Unknown']),
  description: z.string(),
  /** NVD enrichment (CVSS v3.1 base, else v3.0/v2), present only for CVEs NVD has answered for. */
  cvssScore: z.number().min(0).max(10).nullable().optional(),
  cvssSeverity: z.string().nullable().optional(),
  cvssVersion: z.string().nullable().optional(),
});

export const KevResponse = Envelope.extend({
  items: z.array(KevEntry),
  catalogVersion: z.string().nullable(),
  /** CVEs enriched from NVD so far (NVD allows 5 requests / 30 s keyless). */
  enriched: z.number().int().nonnegative().optional(),
});

export const Outage = EntityBase.extend({
  country: z.string(),
  countryCode: z.string().length(2),
  scope: z.string().nullable(),
  cause: z.string().nullable(),
  description: z.string().nullable(),
  startedAt: IsoTime,
  endedAt: IsoTime.nullable(),
  ongoing: z.boolean(),
  provider: z.enum(['IODA', 'Cloudflare Radar']),
  url: z.url().nullable(),
});

export const OutagesResponse = Envelope.extend({ items: z.array(Outage) });

export const AttackOrigin = EntityBase.extend({
  countryCode: z.string().length(2),
  country: z.string(),
  /** Percentage share of L3 attack traffic originating here. */
  sharePct: z.number().min(0).max(100),
  /** Only when the upstream reports the target side; arcs are drawn only then. */
  targetCountryCode: z.string().length(2).nullable().optional(),
});

export const AttackOriginsResponse = Envelope.extend({ items: z.array(AttackOrigin), window: z.string() });

export const SubmarineCable = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().nullable(),
  geometry: z.custom<GeoJSON.MultiLineString | GeoJSON.LineString>(),
  landingPointIds: z.array(z.string()),
  rfsYear: z.number().int().nullable(),
  lengthKm: z.number().nullable(),
  owners: z.string().nullable(),
  url: z.url().nullable(),
});

export const LandingPoint = EntityBase.extend({ name: z.string(), country: z.string().nullable() });

export const CablesResponse = Envelope.extend({
  cables: z.array(SubmarineCable),
  landingPoints: z.array(LandingPoint),
});

/**
 * One entity pushed by a third-party GODSEYE SDK client (POST /api/sdk/ingest). Always labelled
 * third-party; the server stamps `ingestedAt` and never treats it as first-party data.
 */
export const SdkEntityInput = z.object({
  id: z.string().min(1).max(128).regex(/^[\w.:-]+$/),
  name: z.string().min(1).max(160),
  domain: z.enum(['AIR', 'SEA', 'LAND', 'SPACE', 'CYBER', 'EW', 'SUBSURFACE']),
  entityType: z.enum(['TRACK', 'FACILITY', 'EVENT', 'SENSOR', 'SIGNAL', 'INTEL']),
  position: z.object({ lat: Lat, lng: Lng, alt: z.number().finite().optional(), heading: z.number().min(0).max(360).optional(), speed: z.number().min(0).optional() }),
  timestamp: IsoTime,
  source: z.object({ system: z.string().min(1).max(64), sensor: z.string().max(64).optional() }),
  threat: z.enum(['NONE', 'LOW', 'ELEVATED', 'HIGH', 'CRITICAL']).optional(),
  properties: z.record(z.string(), z.union([z.string().max(512), z.number(), z.boolean(), z.null()])).optional(),
});

export const SdkIngestBatch = z.object({ entities: z.array(z.unknown()).min(1).max(500) });

export const SdkEntity = SdkEntityInput.extend({
  thirdParty: z.literal(true),
  label: z.literal('THIRD-PARTY (SDK)'),
  ingestedAt: IsoTime,
});

/** POST /api/sdk/ingest result. */
export const SdkIngestResponse = z.object({ accepted: z.number().int().nonnegative(), rejected: z.number().int().nonnegative(), errors: z.array(z.string()) });
