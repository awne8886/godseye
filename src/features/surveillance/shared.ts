/**
 * Surveillance constants and pure helpers shared by the server routes and the client layers.
 * Isomorphic (no server-only imports). Owner: layers-surveillance.
 */
import { contactFrom, REPO_URL } from '@/lib/config';
import type { z } from 'zod';
import type { RemovalContact as RemovalContactSchema } from '@/lib/schemas/surveillance';
import type { Camera } from '@/lib/types';

export type RemovalContact = z.infer<typeof RemovalContactSchema>;

/**
 * Catalogue regions. One `/api/cctv?region=` response per region keeps every payload far under
 * the 4 MB cap (the largest, us-west, is ~6k rows ≈ 1.6 MB uncompressed).
 */
export const CCTV_REGIONS = ['us-west', 'texas', 'us-midwest', 'canada', 'uk', 'europe', 'nordics', 'asia', 'oceania'] as const;
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
