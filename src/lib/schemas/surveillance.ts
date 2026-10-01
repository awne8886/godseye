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
  /**
   * Why the camera is offline (`not_an_image` = the operator answered with a web page, `upstream_404`,
   * `timeout`…), or why the status is unknown (`queued`: this server's per-operator queue was busy,
   * so the operator was not asked in time).
   */
  reason: z.string().optional(),
});

/**
 * Where a relayed frame's time came from: the operator's published timestamp (`operator`), the
 * frame file's HTTP Last-Modified (`last-modified`), or nothing (`none`: the age is unknown and the
 * frame is never shown as current — only its fetch time is known).
 */
export const FrameTimeSource = z.enum(['operator', 'last-modified', 'none']);

/**
 * Body of a failed `/api/cctv/proxy` or `/api/cctv/texas/snapshot` answer. `state: 'offline'` means
 * the operator answered but the camera has no usable frame (a web page instead of an image, 404,
 * an empty snapshot); `unavailable` is a transient failure (timeout, 5xx, `queued` = this server's
 * per-operator queue was busy) worth a retry.
 */
export const FrameError = z.object({
  error: z.literal('frame_unavailable'),
  detail: z.string(),
  state: z.enum(['offline', 'unavailable']),
  /** Plain-language reason for the viewer (never upstream text). */
  message: z.string(),
  /** Declared content type of a refused non-image answer (sanitised `type/subtype`), else null. */
  upstreamType: z.string().nullable(),
  /**
   * When this server requested the frame from the operator; null when no request was made (a
   * link-out-only provider, a camera without a still, an address refused before connecting, or a
   * request that never left this server's queue).
   */
  fetchedAt: IsoTime.nullable(),
});

/**
 * Frame availability of one provider over the last `windowS` seconds, from the frames this server
 * actually requested (bytes are never kept, only success/failure and the frame time). Per camera the
 * latest attempt counts, and only operator-wide failures (a web page instead of an image, a 5xx, a
 * network failure, an operator timeout) count against the operator — a missing image (404/410, no
 * snapshot), an address off the allow-list or this server's own queue are per camera or ours.
 * `unavailable` = at least 5 distinct cameras tried and more than 90 % of them failing operator-wide
 * (FRAMES UNAVAILABLE); `failing` = at least 5 tried and more than half failing operator-wide;
 * `available` = otherwise, with at least one camera's latest frame relayed; `inconclusive` = cameras
 * tried, none relayed, but too few (or only per-camera failures) to judge the operator;
 * `unchecked` = no frame requested in the window.
 */
export const FrameHealthState = z.enum(['unchecked', 'available', 'failing', 'unavailable', 'inconclusive']);

export const FrameHealth = z.object({
  state: FrameHealthState,
  windowS: z.number().int().positive(),
  attempts: z.number().int().nonnegative(),
  ok: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  /** Distinct cameras tried in the window, and how many of them failed on their latest attempt. */
  cameras: z.number().int().nonnegative(),
  camerasFailing: z.number().int().nonnegative(),
  /** Of `camerasFailing`, the cameras whose latest failure points at the operator rather than the camera. */
  camerasOperatorFault: z.number().int().nonnegative().optional(),
  /** Failure reasons in the window (`not_an_image`, `upstream_404`, `timeout`…). */
  errors: z.record(z.string(), z.number().int().nonnegative()),
  lastOkAt: IsoTime.nullable(),
  lastFailAt: IsoTime.nullable(),
  lastError: z.string().nullable(),
  /**
   * Age in seconds of the newest relayed frame when it was fetched, from the operator's own frame
   * time (published timestamp or Last-Modified); null when the operator publishes none.
   */
  lastFrameAge_s: z.number().nonnegative().nullable(),
  /** Frames relayed in the window that carried no operator frame time. */
  untimed: z.number().int().nonnegative(),
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

export const CameraProvidersResponse = Envelope.extend({
  items: z.array(CameraProvider),
  removal: RemovalContact.optional(),
  notWired: z.array(CameraSourceNotWired).optional(),
  /** Frame availability per provider id (proxied providers only; `providers` covers the inventory lists). */
  frames: z.record(z.string(), FrameHealth).optional(),
});

/** GET /api/cctv/resolve */
export const CameraResolveResponse = z.object({
  camera: Camera,
  provider: CameraProvider,
  playable: z.object({ type: StreamType, url: z.string() }).nullable(),
  timestamp: IsoTime,
});
