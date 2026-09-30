'use client';
/**
 * Boot-time behaviour (headless):
 * - Capability defaults: once /api/health loads, and only when the URL had no `?layers=`, apply
 *   defaultLayersFor(capabilities) so licence-gated defaults never reach a share link or a route.
 * - Intro fly-in after the splash: skipped when the URL carries an explicit camera (`?c=`, legacy
 *   `?lat=&lon=`) or a view another module frames itself (`?route=`, `?flight=`, `?dossier=`), so a
 *   deep link is never overridden; otherwise lands on the visitor's region only if they consented
 *   to geolocation (Settings or the locate button), else on the deterministic landingCityFor(today).
 * - `?route=` / `?flight=` deep links open the PATHS panel (unless the URL names another panel).
 * Owner: design-system-hud.
 */
import { useEffect, useRef } from 'react';
import { defaultLayersFor } from '@/lib/layer-registry';
import { hasCameraDeepLink, requestIntroFlyTo } from '@/lib/map/camera';
import { landingCityFor } from '@/lib/presets';
import { useUiStore, type UiState } from '@/lib/store';
import { parseFlightParam, parseLatLngParam, parseRouteParam } from '@/lib/url-state';
import { useHealth } from './hooks';

/** Captured at module load (before UrlStateSync can write the URL back). */
const initialParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
const initialHadLayers = initialParams.has('layers');

/** Why the intro fly-in must not run (null = run it). Pure; unit-tested. */
export function introSkipReason(
  params: URLSearchParams,
  ui: Pick<UiState, 'cameraFromUrl' | 'plannedRoute' | 'flightIdent' | 'dossierTarget'>,
): 'camera' | 'route' | 'flight' | 'dossier' | null {
  if (ui.cameraFromUrl || params.has('c') || (params.has('lat') && (params.has('lon') || params.has('lng')))) return 'camera';
  if (ui.plannedRoute || parseRouteParam(params.get('route'))) return 'route';
  if (ui.flightIdent || parseFlightParam(params.get('flight'))) return 'flight';
  if (ui.dossierTarget || parseLatLngParam(params.get('dossier'))) return 'dossier';
  return null;
}

/** The panel a deep link should open: PATHS for `?route=` / `?flight=` unless `?panel=`/`?dossier=` names one. */
export function deepLinkPanel(params: URLSearchParams): 'paths' | null {
  if (params.get('panel') || params.get('dossier')) return null;
  return parseRouteParam(params.get('route')) || parseFlightParam(params.get('flight')) ? 'paths' : null;
}

/** Applies deepLinkPanel() and the route/flight themselves (idempotent with UrlStateSync's restore). */
export function applyDeepLink(params: URLSearchParams): void {
  const ui = useUiStore.getState();
  const route = parseRouteParam(params.get('route'));
  const flight = parseFlightParam(params.get('flight'));
  if (route && !ui.plannedRoute) ui.setPlannedRoute(route);
  if (flight && !ui.flightIdent) ui.setFlightIdent(flight);
  if (deepLinkPanel(params) && !useUiStore.getState().openPanel) ui.setOpenPanel('paths');
}

export function sameSet(a: ReadonlySet<string>, b: readonly string[]): boolean {
  return a.size === b.length && b.every((x) => a.has(x));
}

/**
 * Browser geolocation, only ever called after an explicit opt-in. A click ("Centre on my region")
 * is an explicit camera request; the boot intro passes `intro: true` so it goes through
 * requestIntroFlyTo() and never overrides a deep link or a move the visitor made meanwhile.
 */
export function locateOnce(zoom = 5, { intro = false }: { intro?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(false);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const target = { lat: p.coords.latitude, lng: p.coords.longitude, zoom, pitch: 30, bearing: 0, durationMs: 3000 };
        if (intro) requestIntroFlyTo(useUiStore.getState, target);
        else useUiStore.getState().requestFlyTo(target);
        resolve(true);
      },
      () => resolve(false),
      { enableHighAccuracy: false, maximumAge: 600_000, timeout: 8000 },
    );
  });
}

export default function Boot() {
  const health = useHealth();
  const applied = useRef(false);
  const splashDone = useUiStore((s) => s.splashDone);
  const flown = useRef(false);

  // Deep links: open PATHS for ?route= / ?flight= on mount, and again once the splash is gone in
  // case a restore raced it (never over a panel the visitor opened in between).
  useEffect(() => applyDeepLink(initialParams), []);
  useEffect(() => {
    if (splashDone) applyDeepLink(initialParams);
  }, [splashDone]);

  useEffect(() => {
    if (applied.current || !health.data) return;
    applied.current = true;
    if (initialHadLayers) return;
    const defaults = defaultLayersFor(health.data.capabilities);
    const ui = useUiStore.getState();
    if (!sameSet(ui.activeLayers, defaults)) ui.setLayers(defaults);
  }, [health.data]);

  useEffect(() => {
    if (!splashDone || flown.current) return;
    flown.current = true;
    const ui = useUiStore.getState();
    if (introSkipReason(initialParams, ui) || hasCameraDeepLink(ui)) return;
    const city = landingCityFor(new Date());
    const toCity = () => requestIntroFlyTo(useUiStore.getState, { lat: city.lat, lng: city.lng, zoom: 3.4, pitch: 25, bearing: 0, durationMs: 3500 });
    if (ui.settings.geoConsent === 'granted') void locateOnce(4.5, { intro: true }).then((ok) => ok || toCity());
    else toCity();
  }, [splashDone]);

  return null;
}
