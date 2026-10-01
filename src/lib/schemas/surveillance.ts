/**
 * Surveillance contracts. Owner: layers-surveillance.
 * Every camera source is a registry row shown in the viewer header and the attribution panel.
 * Excluded by policy: OpenCCTV API, Insecam/Opentopia-style directories, EarthCam/Skyline frames.
 */
import { z } from 'zod';
import { EntityBase, Envelope, columnarResponse, IsoTime } from './common';

export const StreamType = z.enum(['jpg', 'mjpeg', 'hls', 'mp4', 'iframe', 'link']);

/** One camera provider (§5 registry row). */
export const CameraProvider = z.object({
  id: z.string(),
  operator: z.string(),
  region: z.string(),
  country: z.string(),
  list_endpoint: z.string(),
  frame_url_template: z.string().nullable(),
  stream_type: StreamType,
  licence: z.string(),
  attribution_string: z.string(),
  terms_url: z.url(),
  key_required: z.boolean(),
  /** Minimum seconds between frame polls allowed by the operator. */
  max_poll_interval: z.number().int().positive(),
  /** Whether stills may pass through GODSEYE's stills-only proxy (else link-out/embed only). */
  proxy_allowed: z.boolean(),
  /** Region-level link-out-only mode (compliance). */
  link_out_only: z.boolean(),
});

export const Camera = EntityBase.extend({
  name: z.string(),
  providerId: z.string(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  streamType: StreamType,
  /** Still image URL (fetched via /api/cctv/proxy when proxy_allowed). */
  stillUrl: z.string().nullable(),
  /** Direct HLS/MP4/MJPEG/iframe URL from the operator. */
  streamUrl: z.string().nullable(),
  /** Operator page for link-out. */
  externalUrl: z.string().nullable(),
  headingDeg: z.number().nullable(),
});

export const CAMERA_FIELDS = [
  'id',
  'lat',
  'lng',
  'name',
  'providerId',
  'city',
  'country',
  'streamType',
  'stillUrl',
  'streamUrl',
  'externalUrl',
  'observedAt',
  'source',
] as const;

/** GET /api/cctv?region= — split by region so each response stays < 4 MB. */
export const CctvResponse = columnarResponse(CAMERA_FIELDS).extend({
  regions: z.array(z.string()),
  pendingRegions: z.array(z.string()),
  counts: z.record(z.string(), z.number().int().nonnegative()),
  /**
   * Requested regions whose every provider needs a key this instance does not have: not an
   * outage, just not configured (their providers report `skipped: 'not-configured'`).
   */
  disabledRegions: z.array(z.string()).optional(),
});

export const StreamStatusResponse = z.object({
  id: z.string(),
  status: z.enum(['online', 'offline', 'unknown']),
  checkedAt: IsoTime,
  httpStatus: z.number().int().nullable(),
});

export const NewsChannel = EntityBase.extend({
  name: z.string(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  youtubeChannelId: z.string().nullable(),
  /** Official embed URL (`youtube-nocookie` live_stream) when the broadcaster allows embedding. */
  embedUrl: z.url().nullable(),
  externalUrl: z.url(),
  embedAllowed: z.boolean(),
  category: z.enum(['mainstream', 'government', 'finance', 'conflict', 'state']),
  language: z.string(),
  /**
   * Result of the runtime live check (null before the first check or when the page could not be
   * read). `observedAt` is the time of that check, null when it produced no answer.
   */
  live: z.boolean().nullable(),
});

export const LiveNewsResponse = Envelope.extend({ items: z.array(NewsChannel) });

/**
 * Where camera removal requests go on this instance: the operator's GODSEYE_CONTACT (email or
 * https URL) when set, else the GODSEYE project's public issue tracker.
 */
export const RemovalContact = z.object({ kind: z.enum(['tracker', 'email', 'url']), href: z.string() });

/** GET /api/cctv/providers */
/** A source OSIRIS uses that this registry deliberately does not wire, with the probe-backed reason. */
export const CameraSourceNotWired = z.object({ id: z.string(), operator: z.string(), region: z.string(), country: z.string(), reason: z.string(), probedAt: z.string() });

export const CameraProvidersResponse = Envelope.extend({ items: z.array(CameraProvider), removal: RemovalContact.optional(), notWired: z.array(CameraSourceNotWired).optional() });

/** GET /api/cctv/resolve */
export const CameraResolveResponse = z.object({
  camera: Camera,
  provider: CameraProvider,
  playable: z.object({ type: StreamType, url: z.string() }).nullable(),
  timestamp: IsoTime,
});
