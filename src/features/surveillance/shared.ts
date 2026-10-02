/**
 * Surveillance constants and pure helpers shared by the server routes and the client layers.
 * Isomorphic (no server-only imports). Owner: layers-surveillance.
 */
import { contactFrom, REPO_URL } from '@/lib/config';
import { formatAge } from '@/lib/freshness';
import type { z } from 'zod';
import type { RemovalContact as RemovalContactSchema } from '@/lib/schemas/surveillance';
import type { Camera, FrameHealth } from '@/lib/types';

export type RemovalContact = z.infer<typeof RemovalContactSchema>;

/**
 * Catalogue regions. One `/api/cctv?region=` response per region keeps every payload far under
 * the 4 MB cap (the largest, us-west, is ~6k rows ≈ 1.6 MB uncompressed).
 */
export const CCTV_REGIONS = ['us-west', 'texas', 'us-midwest', 'canada', 'uk', 'europe', 'nordics', 'asia', 'japan', 'oceania'] as const;
export type CctvRegion = (typeof CCTV_REGIONS)[number];

/** `[west, south, east, north]` boxes used by `?lat=&lng=` region selection. */
export const REGION_BOUNDS: Record<CctvRegion, [number, number, number, number]> = {
  'us-west': [-125, 32, -114, 49.5],
  texas: [-107, 25.5, -93.5, 36.6],
  'us-midwest': [-90.5, 37.7, -82, 48.5],
  canada: [-141, 41.5, -52, 70],
  uk: [-8.7, 49.8, 1.8, 60.9],
  europe: [-10, 35.5, 8, 54],
  nordics: [-25, 53.8, 32, 71.5],
  asia: [100, 0.5, 125, 27],
  japan: [122, 20, 154, 46],
  oceania: [140, -48, 179.9, -9],
};

/**
 * Regions whose every provider needs an operator key (capability id → provider name). The client
 * requests such a region only when /api/health reports one of its capabilities enabled, and lists
 * it as "needs key" otherwise; the registry test keeps this in step with the server registry.
 */
export const KEYED_REGIONS: Partial<Record<CctvRegion, readonly { capability: string; provider: string; label: string }[]>> = {
  uk: [{ capability: 'tfl', provider: 'tfl', label: 'TfL JamCams (TFL_APP_KEY)' }],
};

/** Regions the client may request given /api/health capabilities (before health loads: keyless only). */
export function requestableRegions(caps: Record<string, { enabled: boolean } | undefined> | undefined): { active: CctvRegion[]; needsKey: CctvRegion[] } {
  const active: CctvRegion[] = [];
  const needsKey: CctvRegion[] = [];
  for (const r of CCTV_REGIONS) {
    const keyed = KEYED_REGIONS[r];
    if (!keyed || keyed.some((k) => caps?.[k.capability]?.enabled === true)) active.push(r);
    else needsKey.push(r);
  }
  return { active, needsKey };
}

export function isRegion(s: string): s is CctvRegion {
  return (CCTV_REGIONS as readonly string[]).includes(s);
}

/** Regions whose box contains the point; the nearest box centre when none does. */
export function regionsForPoint(lat: number, lng: number): CctvRegion[] {
  const hits = CCTV_REGIONS.filter((r) => {
    const [w, s, e, n] = REGION_BOUNDS[r];
    return lng >= w && lng <= e && lat >= s && lat <= n;
  });
  if (hits.length) return hits;
  let best: CctvRegion = CCTV_REGIONS[0];
  let bestD = Infinity;
  for (const r of CCTV_REGIONS) {
    const [w, s, e, n] = REGION_BOUNDS[r];
    const d = (lat - (s + n) / 2) ** 2 + (lng - (w + e) / 2) ** 2;
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return [best];
}

/** Provider id is the camera id's prefix (`caltrans-…`, `txdot-…`). */
export function providerIdOf(cameraId: string): string {
  const i = cameraId.indexOf('-');
  return i > 0 ? cameraId.slice(0, i) : cameraId;
}

/** `CAM-llll-gggg` tag from coordinates (OSIRIS viewer header), e.g. CAM-3408N-11822W. */
export function cameraTag(lat: number, lng: number): string {
  const la = `${Math.round(Math.abs(lat) * 100)}`.padStart(4, '0') + (lat >= 0 ? 'N' : 'S');
  const lo = `${Math.round(Math.abs(lng) * 100)}`.padStart(5, '0') + (lng >= 0 ? 'E' : 'W');
  return `CAM-${la}-${lo}`;
}

/** Same-origin still URL for a camera (stills never load from the operator in the browser). */
export function stillPath(c: Pick<Camera, 'id' | 'providerId'>): string {
  return c.providerId === 'txdot' ? `/api/cctv/texas/snapshot?id=${encodeURIComponent(c.id)}` : `/api/cctv/proxy?id=${encodeURIComponent(c.id)}`;
}

/** Display label for the viewer's feed-type row. */
export const STREAM_LABEL: Record<Camera['streamType'], string> = {
  jpg: 'SNAPSHOT',
  mjpeg: 'MJPEG',
  hls: 'LIVE VIDEO (HLS)',
  mp4: 'LATEST CLIP',
  iframe: 'OPERATOR EMBED',
  link: 'LINK OUT',
};

/** Minimum still refresh in the viewer, even when an operator allows faster polling. */
export const MIN_STILL_REFRESH_S = 10;

/** Preview tiles on the map (OSIRIS parity: zoom ≥ 13, ≤ 8 tiles, ≤ 4 video, 176×99). */
export const PREVIEW_MIN_ZOOM = 13;
export const PREVIEW_MAX_TILES = 8;
export const PREVIEW_MAX_VIDEO = 4;
export const PREVIEW_W = 176;
export const PREVIEW_H = 99;

/**
 * Removal contact for this instance (§0.7): GODSEYE_CONTACT when it is a valid email or https URL
 * (the operator of this instance handles removals), else the project's public issue tracker.
 */
export function removalContact(env: Record<string, string | undefined>): RemovalContact {
  const c = contactFrom(env);
  if (c === `${REPO_URL}/issues`) return { kind: 'tracker', href: c };
  const email = c.replace(/^mailto:/i, '');
  if (/^[^@\s/]+@[^@\s/]+\.[a-z]{2,}$/i.test(email)) return { kind: 'email', href: `mailto:${email}` };
  if (/^https:\/\/[^\s]+$/i.test(c)) return { kind: 'url', href: c };
  return { kind: 'tracker', href: `${REPO_URL}/issues` };
}

/** Prefilled removal request for a contact: mail, the published URL as is, or a tracker issue. */
export function removalHref(contact: RemovalContact, title: string, body: string): string {
  if (contact.kind === 'url') return contact.href;
  if (contact.kind === 'email') return `${contact.href}?${new URLSearchParams({ subject: title, body }).toString().replace(/\+/g, '%20')}`;
  return `${contact.href}/new?${new URLSearchParams({ title, body, labels: 'camera-removal' }).toString()}`;
}

/**
 * CCTV point styling per zoom band (map landing view ≈ z 2): cameras shrink to ≤ 1.5 px without a
 * stroke when zoomed out so thousands of them never merge into solid blobs (visual-qa M9); positions
 * are never moved or aggregated. `getRadius` is 3 px (still) / 4 px (video) × `scale`, capped at `maxPx`.
 */
export const CCTV_ZOOM_BANDS = [
  { maxZoom: 3, scale: 0.4, maxPx: 1.5, stroked: false, opacity: 0.55 },
  { maxZoom: 5, scale: 0.55, maxPx: 2, stroked: false, opacity: 0.7 },
  { maxZoom: 7, scale: 0.75, maxPx: 3, stroked: true, opacity: 0.85 },
  { maxZoom: 9, scale: 1, maxPx: 4, stroked: true, opacity: 1 },
  { maxZoom: Infinity, scale: 1.15, maxPx: 6, stroked: true, opacity: 1 },
] as const;

export function zoomBand(zoom: number): number {
  const i = CCTV_ZOOM_BANDS.findIndex((b) => zoom < b.maxZoom);
  return i < 0 ? CCTV_ZOOM_BANDS.length - 1 : i;
}

// ── Frame freshness and availability (viewer, preview tiles, camera card) ───────
export type FrameAge = { state: 'recent' | 'stale' | 'unknown'; label: string; ageS: number | null };

/** A frame is current for this many operator intervals (each counted as at least 60 s). */
export const FRAME_RECENT_INTERVALS = 6;

/** Oldest frame age (seconds) still called current for an operator polled every `cadenceS`. */
export function frameRecentS(cadenceS: number): number {
  return FRAME_RECENT_INTERVALS * Math.max(60, Number.isFinite(cadenceS) ? cadenceS : 60);
}

/**
 * Freshness of one relayed still from the operator's own frame time (`X-Frame-Observed-At`). A
 * still is a snapshot, so this is never LIVE: `recent` within 6 operator intervals (≥ 60 s each),
 * then `stale`. No frame time (or one more than a minute in the future) is `unknown` ("UNTIMED"):
 * only the fetch time is known, and the frame is never presented as current.
 */
export function frameAge(observedAt: string | null | undefined, cadenceS: number, now: number = Date.now()): FrameAge {
  const t = observedAt ? Date.parse(observedAt) : NaN;
  if (!Number.isFinite(t) || t - now > 60_000) return { state: 'unknown', label: 'UNTIMED', ageS: null };
  const ageMs = Math.max(0, now - t);
  const ageS = Math.round(ageMs / 1000);
  const recent = ageMs <= frameRecentS(cadenceS) * 1000;
  return recent ? { state: 'recent', label: formatAge(ageMs), ageS } : { state: 'stale', label: `STALE · ${formatAge(ageMs)}`, ageS };
}

/** A failed stills-proxy answer as the client reads it (FrameError in the schema). */
export interface FrameFailure {
  /** `offline`: the operator answered without a usable frame (CAMERA OFFLINE); `unavailable`: transient (FEED UNAVAILABLE). */
  state: 'offline' | 'unavailable';
  detail: string;
  message: string;
}

/** Read a failed proxy answer; anything unreadable is a transient FEED UNAVAILABLE. */
export function readFrameFailure(status: number, body: unknown): FrameFailure {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const detail = typeof b.detail === 'string' && /^[a-z0-9_]{1,40}$/.test(b.detail) ? b.detail : `http_${status}`;
  const state = b.state === 'offline' ? 'offline' : 'unavailable';
  const message = typeof b.message === 'string' && b.message.length <= 200 ? b.message : 'The frame could not be loaded. Try again.';
  return { state, detail, message };
}

/** Short HUD wording for a frame failure reason (proxy `detail`, stream-status `reason`). */
export const FRAME_REASON_LABEL: Record<string, string> = {
  not_an_image: 'NOT AN IMAGE',
  upstream_404: 'NO FRAME (404)',
  upstream_410: 'NO FRAME (410)',
  no_snapshot: 'NO SNAPSHOT',
  no_still: 'NO STILL',
  timeout: 'TIMEOUT',
  queued: 'SERVER BUSY',
  too_large: 'FILE TOO LARGE',
  blocked: 'OFF ALLOW-LIST',
  network: 'UNREACHABLE',
};

type FrameHealthView = Pick<FrameHealth, 'state' | 'cameras' | 'camerasFailing' | 'camerasOperatorFault'> & Partial<Pick<FrameHealth, 'lastFrameAge_s' | 'freshestFrameAge_s' | 'untimed'>>;

/**
 * Card / viewer wording for a provider's frame availability (/api/cctv/providers `frames`). FAILING
 * and UNAVAILABLE count operator-wide failures over at least 5 cameras; a handful of failed cameras
 * is only ever "NO FRAME RELAYED", never a verdict on the operator.
 *
 * Round 5 (R2 minor 4): AVAILABLE (green) means fresh frames — the freshest relayed frame was at
 * most 6 operator intervals (`cadenceS`, ≥ 60 s each) old when fetched, the viewer's own rule.
 * Older frames read `STALE · FRAMES 21h OLD` (warn); frames without any operator time read
 * `RELAYED · UNTIMED` (never green: their age is unknown).
 */
export function frameHealthLabel(h: FrameHealthView | null | undefined, cadenceS = 60): { text: string; tone: 'ok' | 'warn' | 'error' | 'idle' } {
  if (!h || h.state === 'unchecked') return { text: 'NOT CHECKED YET', tone: 'idle' };
  const down = h.camerasOperatorFault ?? h.camerasFailing;
  if (h.state === 'unavailable') return { text: `UNAVAILABLE · ${down}/${h.cameras} FAILING`, tone: 'error' };
  if (h.state === 'failing') return { text: `FAILING · ${down}/${h.cameras} CAMERAS`, tone: 'warn' };
  if (h.state === 'inconclusive') return { text: `NO FRAME RELAYED · ${h.cameras} TRIED`, tone: 'idle' };
  const without = h.camerasFailing ? ` · ${h.camerasFailing}/${h.cameras} WITHOUT FRAME` : '';
  // Older servers sent only the last relayed frame's age.
  const age = h.freshestFrameAge_s !== undefined ? h.freshestFrameAge_s : (h.lastFrameAge_s ?? null);
  if (age === null) return { text: `RELAYED · UNTIMED${without}`, tone: 'idle' };
  if (age > frameRecentS(cadenceS)) return { text: `STALE · FRAMES ${formatAge(age * 1000)} OLD${without}`, tone: 'warn' };
  return { text: `AVAILABLE${without}`, tone: 'ok' };
}

/** One plain sentence for an operator whose frames are unavailable (null otherwise). */
export function frameHealthNote(h: Pick<FrameHealth, 'state' | 'errors' | 'failed'> | null | undefined): string | null {
  if (!h || h.state !== 'unavailable') return null;
  const pages = (h.errors.not_an_image ?? 0) * 2 > h.failed;
  return pages
    ? 'This operator is answering with web pages instead of camera images for almost every camera tried in the last 10 minutes (a fault on the operator side). Each camera is still retried at the operator’s interval.'
    : 'This operator failed with server errors, timeouts or connection failures for almost every camera tried in the last 10 minutes. Each camera is still retried at the operator’s interval.';
}

/** `hh:mmZ` of an ISO time (HUD clock), or null. */
export function hhmmZ(iso: string | null | undefined): string | null {
  return iso && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso) ? `${iso.slice(11, 16)}Z` : null;
}
