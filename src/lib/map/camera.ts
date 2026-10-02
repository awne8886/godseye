/**
 * Camera request precedence (visual-qa m12, R4-B2). All camera moves go through the store's
 * `flyTo` request; the map host applies them once the style is parsed (`style.load`, the
 * `data-style-ready` point; camera moves need no tiles). The boot intro fly-in is the only
 * *implicit* request: it must never override an explicit one (deep link `?route=`/`?flight=`/
 * `?dossier=`/`?c=`, search, presets…), whichever order they were issued in.
 *  - `requestIntroFlyTo()` issues the intro only while no explicit request exists and no deep link
 *    is pending, and marks it as intro;
 *  - `nextCameraRequest()` is what the host applies: pending requests wait for style readiness and
 *    are applied once, an intro request is skipped once an explicit request has been seen.
 * Owner: map-engine. Pure (store passed in) and unit-tested.
 */
import type { FlyToRequest } from '@/lib/store';

/** The store fields this module reads (a zustand `useUiStore` state satisfies it). */
export interface CameraStoreState {
  flyTo: FlyToRequest | null;
  cameraFromUrl?: boolean;
  dossierTarget?: unknown;
  plannedRoute?: unknown;
  flightIdent?: unknown;
  requestFlyTo: (r: Omit<FlyToRequest, 'ts'>) => void;
}

const introTs = new Set<number>();
let explicitSeen = false;

export function isIntroRequest(req: FlyToRequest | null | undefined): boolean {
  return !!req && introTs.has(req.ts);
}

/** Record every request the host observes (so a later intro knows an explicit one exists). */
export function noteCameraRequest(req: FlyToRequest | null | undefined): void {
  if (req && !introTs.has(req.ts)) explicitSeen = true;
}

/** A deep link that frames the camera itself (or a camera restored from `?c=`). */
export function hasCameraDeepLink(s: Pick<CameraStoreState, 'cameraFromUrl' | 'dossierTarget' | 'plannedRoute' | 'flightIdent'>): boolean {
  return !!(s.cameraFromUrl || s.dossierTarget || s.plannedRoute || s.flightIdent);
}

/**
 * Issue the boot intro fly-in unless an explicit camera request exists or a deep link will frame
 * the camera. Returns true when the intro was requested.
 */
export function requestIntroFlyTo(get: () => CameraStoreState, r: Omit<FlyToRequest, 'ts'>): boolean {
  const s = get();
  noteCameraRequest(s.flyTo);
  if (explicitSeen || hasCameraDeepLink(s)) return false;
  s.requestFlyTo(r);
  const issued = get().flyTo;
  if (issued) introTs.add(issued.ts);
  return true;
}

/**
 * The request the host should apply now, or null: nothing new, the style is not parsed yet (the
 * request stays pending in the store and is applied on `style.load`), already served, or an intro
 * that an explicit request has superseded.
 */
export function nextCameraRequest(req: FlyToRequest | null, styleReady: boolean, servedTs: number): FlyToRequest | null {
  if (!req) return null;
  noteCameraRequest(req);
  if (!styleReady || req.ts === servedTs) return null;
  if (isIntroRequest(req) && explicitSeen) return null;
  return req;
}

/** Initial framing for a `?dossier=lat,lng` deep link when no `?c=` camera was restored. */
export function dossierDeepLinkCamera(s: Pick<CameraStoreState, 'cameraFromUrl' | 'dossierTarget'>): Omit<FlyToRequest, 'ts'> | null {
  const t = s.dossierTarget as { lat?: unknown; lng?: unknown } | null | undefined;
  if (s.cameraFromUrl || !t || typeof t.lat !== 'number' || typeof t.lng !== 'number') return null;
  if (!Number.isFinite(t.lat) || !Number.isFinite(t.lng)) return null;
  return { lat: t.lat, lng: t.lng, zoom: 5, pitch: 0, bearing: 0, durationMs: 1500 };
}

/** Test hook. */
export function resetCameraRequests(): void {
  introTs.clear();
  explicitSeen = false;
}
