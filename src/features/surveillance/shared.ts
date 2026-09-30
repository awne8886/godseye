/**
 * Surveillance constants and pure helpers shared by the server routes and the client layers.
 * Isomorphic (no server-only imports). Owner: layers-surveillance.
 */
import type { Camera } from '@/lib/types';

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
  'us-midwest': [-90.5, 41, -82, 48.5],
  canada: [-141, 41.5, -52, 70],
  uk: [-8.7, 49.8, 1.8, 60.9],
  europe: [-10, 35.5, 8, 54],
  nordics: [-25, 54.5, 32, 71.5],
  asia: [100, 0.5, 125, 27],
  oceania: [140, -48, 179.9, -9],
};

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
