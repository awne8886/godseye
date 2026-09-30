'use client';
/**
 * Boot-time behaviour (headless):
 * - Capability defaults: once /api/health loads, and only when the URL had no `?layers=`, apply
 *   defaultLayersFor(capabilities) so licence-gated defaults never reach a share link or a route.
 * - Intro fly-in after the splash: skipped when the camera came from the URL; lands on the
 *   visitor's region only if they consented to geolocation (Settings or the locate button), else on
 *   the deterministic landingCityFor(today).
 * Owner: design-system-hud.
 */
import { useEffect, useRef } from 'react';
import { defaultLayersFor } from '@/lib/layer-registry';
import { landingCityFor } from '@/lib/presets';
import { useUiStore } from '@/lib/store';
import { useHealth } from './hooks';

/** Captured at module load (before UrlStateSync can write the URL back). */
const initialHadLayers = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('layers');

export function sameSet(a: ReadonlySet<string>, b: readonly string[]): boolean {
  return a.size === b.length && b.every((x) => a.has(x));
}

/** Browser geolocation, only ever called after an explicit opt-in. */
export function locateOnce(zoom = 5): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(false);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        useUiStore.getState().requestFlyTo({ lat: p.coords.latitude, lng: p.coords.longitude, zoom, pitch: 30, bearing: 0, durationMs: 3000 });
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
    if (ui.cameraFromUrl) return;
    const city = landingCityFor(new Date());
    const toCity = () => useUiStore.getState().requestFlyTo({ lat: city.lat, lng: city.lng, zoom: 3.4, pitch: 25, bearing: 0, durationMs: 3500 });
    if (ui.settings.geoConsent === 'granted') void locateOnce(4.5).then((ok) => ok || toCity());
    else toCity();
  }, [splashDone]);

  return null;
}
