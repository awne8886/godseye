'use client';
/**
 * Shared HUD hooks: /api/health (capabilities), responsive breakpoint, panel availability.
 * Owner: design-system-hud.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore, type RefObject } from 'react';
import { panelFor } from '@/features/registry';
import { visibleLayers, type LayerDef } from '@/lib/layer-registry';
import type { PanelId } from '@/lib/tool-registry';
import type { HealthResponse } from '@/lib/types';

export type Caps = HealthResponse['capabilities'];

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: async ({ signal }) => {
      const r = await fetch('/api/health', { signal });
      if (!r.ok) throw new Error(`health HTTP ${r.status}`);
      return (await r.json()) as HealthResponse;
    },
    refetchInterval: 60_000,
    retry: 1,
  });
}

/**
 * Whether this build serves an API route, from `/api/health` `routes` (the mounted API paths).
 * Routes owned by later builders are only called once the server lists them, so the browser never
 * logs 404s for features that are not deployed. Absent list → not available (coordinates-only
 * readout, event-based ticker).
 */
export function routeListed(health: HealthResponse | undefined, path: string): boolean {
  const routes = (health as (HealthResponse & { routes?: unknown }) | undefined)?.routes;
  return Array.isArray(routes) && routes.includes(path);
}

export function useApiRoute(path: string): boolean {
  return routeListed(useHealth().data, path);
}

/** Layers the deployment can serve (capability-hidden ones excluded). Before health loads: keyless only. */
export function useVisibleLayers(): LayerDef[] {
  const caps = useHealth().data?.capabilities ?? {};
  return visibleLayers(caps);
}

const MOBILE_QUERY = '(max-width: 767px), (max-height: 499px) and (orientation: landscape)';

function subscribeMedia(query: string) {
  return (cb: () => void) => {
    if (typeof window === 'undefined' || !window.matchMedia) return () => {};
    const mq = window.matchMedia(query);
    mq.addEventListener('change', cb);
    return () => mq.removeEventListener('change', cb);
  };
}

export function useMediaQuery(query: string, serverValue = false): boolean {
  return useSyncExternalStore(
    subscribeMedia(query),
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : serverValue),
    () => serverValue,
  );
}

/** Phones (< 768 px, or landscape < 500 px tall): rails hide, bottom nav + sheets instead. */
export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_QUERY);
}

const subscribeNone = () => () => {};

/** World Remote needs Web Bluetooth. */
export function useHasBluetooth(): boolean {
  return useSyncExternalStore(
    subscribeNone,
    () => typeof navigator !== 'undefined' && 'bluetooth' in navigator,
    () => false,
  );
}

/** A panel can be opened only when some module registered a component for it. */
export function isPanelAvailable(id: PanelId, hasBluetooth: boolean): boolean {
  if (id === 'remote' && !hasBluetooth) return false;
  return panelFor(id) !== null;
}

/**
 * Space (px from the viewport bottom to the element's top edge) a bottom sheet occupies, ignoring
 * its slide transform: offsetHeight + the resolved CSS `bottom`. Null when it cannot be measured.
 */
export function occupiedFromBottom(el: HTMLElement): number | null {
  const bottom = Number.parseFloat(getComputedStyle(el).bottom);
  if (!Number.isFinite(bottom)) return null;
  return Math.round(el.offsetHeight + bottom);
}

/**
 * Publish how much of the screen bottom a phone sheet covers as a CSS custom property on <html>
 * (`--sheet-occupied`, `--card-occupied`), so base.css lifts MapLibre's attribution and imagery
 * chips above it (the attribution stays visible). Cleared as soon as `active` turns false (exit
 * starts), not when the exit animation ends.
 */
export function useBottomReserve(ref: RefObject<HTMLElement | null>, name: '--sheet-occupied' | '--card-occupied', active: boolean) {
  useEffect(() => {
    const root = document.documentElement;
    const el = ref.current;
    if (!active || !el) {
      root.style.removeProperty(name);
      return;
    }
    const write = () => {
      const px = occupiedFromBottom(el);
      if (px === null) root.style.removeProperty(name);
      else root.style.setProperty(name, `${px}px`);
    };
    write();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(write);
    ro?.observe(el);
    window.addEventListener('resize', write);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', write);
      root.style.removeProperty(name);
    };
  }, [ref, name, active]);
}
