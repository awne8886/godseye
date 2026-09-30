'use client';
/**
 * The map application shell: full-viewport map with every control floating above it.
 * Composition only; each piece is owned by its builder. Owner: lead.
 */
import dynamic from 'next/dynamic';
import { Suspense } from 'react';
import UrlStateSync from '@/components/UrlStateSync';
import Header from '@/components/hud/Header';
import LayerRail from '@/components/hud/LayerRail';
import Overlays from '@/components/hud/Overlays';
import Splash from '@/components/hud/Splash';
import StatusBar from '@/components/hud/StatusBar';
import Telemetry from '@/components/hud/Telemetry';
import ViewControls from '@/components/hud/ViewControls';

const MapView = dynamic(() => import('@/components/map/MapView'), { ssr: false });

export default function AppShell() {
  return (
    <main className="fixed inset-0 overflow-hidden bg-[var(--bg-void)]">
      <div className="absolute inset-0 z-[1]">
        <MapView />
      </div>
      <Overlays />
      <Header />
      <Telemetry />
      <LayerRail />
      <ViewControls />
      <StatusBar />
      <Splash />
      <Suspense fallback={null}>
        <UrlStateSync />
      </Suspense>
    </main>
  );
}
