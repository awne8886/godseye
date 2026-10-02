'use client';
/**
 * Feature module mounts. `FeatureLayers` mounts each module's Layer while any of its layers is
 * active, from the map host's first render (their feeds load during start-up; their native and deck
 * layers wait for the ready map and the admission queue). `FeatureBackgrounds` mounts every module's
 * Background (flight-paths route planner; panels-recon DRAW/ROUTE/ARCGIS overlays) as soon as the
 * map is usable: they serve the user's own route and clicks and must not wait for the data layers. The deck entries a Background
 * publishes (keyed by its module id) are the user's focus layers: registered here, before any
 * Background can publish, so the admission queue serves them first (src/lib/map/focus.ts).
 * Owner: map-engine.
 */
import { useMemo } from 'react';
import { modulesForLayers, FEATURE_MODULES } from '@/features/registry';
import { focusKeysOf, registerFocusKeys } from '@/lib/map/focus';
import { useUiStore } from '@/lib/store';

registerFocusKeys(focusKeysOf(FEATURE_MODULES));

export default function FeatureLayers() {
  const active = useUiStore((s) => s.activeLayers);
  const mounted = useMemo(() => modulesForLayers(active), [active]);
  return (
    <>
      {mounted.map(({ module, active: on }) => {
        const L = module.Layer!;
        return <L key={module.id} active={on} />;
      })}
    </>
  );
}

export function FeatureBackgrounds() {
  return (
    <>
      {FEATURE_MODULES.filter((m) => m.Background).map((m) => {
        const B = m.Background!;
        return <B key={`${m.id}:bg`} />;
      })}
    </>
  );
}
