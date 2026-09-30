/**
 * Network intel contracts. Owner: layers-threats-network.
 * Blocklist indicators (Feodo, ThreatFox) render as points labelled INDICATOR. Attack arcs are
 * drawn only from real, attributed telemetry (Cloudflare Radar origin→target), never synthesised.
 * Geolocated IPs carry `geoPrecision` because an IP's position is approximate by nature.
 */
import { z } from 'zod';
import { EntityBase, Envelope, IsoTime } from './common';

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

export const MalwareResponse = Envelope.extend({ items: z.array(MalwareHost) });

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
  lastOnline: IsoTime.nullable(),
  geoPrecision: GeoPrecision,
  label: z.literal('INDICATOR'),
});

export const C2Response = Envelope.extend({ items: z.array(C2Server) });

export const ThreatIndicator = EntityBase.extend({
  ioc: z.string(),
  iocType: z.string(),
  threatType: z.string(),
  malware: z.string().nullable(),
  confidence: z.number().int().min(0).max(100).nullable(),
  reference: z.url().nullable(),
  geoPrecision: GeoPrecision,
  label: z.literal('INDICATOR'),
});

export const ThreatFoxResponse = Envelope.extend({ items: z.array(ThreatIndicator) });

export const KevEntry = z.object({
  cveId: z.string().regex(/^CVE-\d{4}-\d{4,}$/),
  vendor: z.string(),
  product: z.string(),
  name: z.string(),
  dateAdded: z.string(),
  dueDate: z.string().nullable(),
  ransomware: z.enum(['Known', 'Unknown']),
  description: z.string(),
});

export const KevResponse = Envelope.extend({ items: z.array(KevEntry), catalogVersion: z.string().nullable() });

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

/** POST /api/sdk/ingest result. */
export const SdkIngestResponse = z.object({ accepted: z.number().int().nonnegative(), rejected: z.number().int().nonnegative(), errors: z.array(z.string()) });
