'use client';
/**
 * The map application shell: full-viewport map with every control floating above it.
 * Composition only: the map (map-engine) and the HUD root (design-system-hud). Owner: lead.
 */
import dynamic from 'next/dynamic';
import { Suspense } from 'react';
import UrlStateSync from '@/components/UrlStateSync';
import HudRoot from '@/components/hud/HudRoot';

const MapView = dynamic(() => import('@/components/map/MapView'), { ssr: false });

export default function AppShell() {
  return (
    <main className="fixed inset-0 overflow-hidden bg-[var(--bg-void)]">
      {/* No z-index on the map wrapper: MapLibre's attribution control must be able to sit above the
          vignette/sensor overlays (base.css lifts .maplibregl-ctrl-bottom-*). */}
      <div className="absolute inset-0">
        <MapView />
      </div>
      <HudRoot />
      <Suspense fallback={null}>
        <UrlStateSync />
      </Suspense>
    </main>
  );
}
