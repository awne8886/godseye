/**
 * Surveillance contracts. Owner: layers-surveillance.
 * Every camera source is a registry row shown in the viewer header and the attribution panel.
 * Excluded by policy: OpenCCTV API, Insecam/Opentopia-style directories, EarthCam/Skyline frames.
 */
import { z } from 'zod';
import { EntityBase, Envelope, columnarResponse } from './common';

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
] as const;

/** GET /api/cctv?region= — split by region so each response stays < 4 MB. */
export const CctvResponse = columnarResponse(CAMERA_FIELDS).extend({
  regions: z.array(z.string()),
  pendingRegions: z.array(z.string()),
  counts: z.record(z.string(), z.number().int().nonnegative()),
});

export const StreamStatusResponse = z.object({
  id: z.string(),
  status: z.enum(['online', 'offline', 'unknown']),
  checkedAt: z.string(),
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
  /** Result of the runtime live check (null before the first check). */
  live: z.boolean().nullable(),
});

export const LiveNewsResponse = Envelope.extend({ items: z.array(NewsChannel) });

/** GET /api/cctv/providers */
export const CameraProvidersResponse = Envelope.extend({ items: z.array(CameraProvider) });

/** GET /api/cctv/resolve */
export const CameraResolveResponse = z.object({
  camera: Camera,
  provider: CameraProvider,
  playable: z.object({ type: StreamType, url: z.string() }).nullable(),
  timestamp: z.string(),
});
