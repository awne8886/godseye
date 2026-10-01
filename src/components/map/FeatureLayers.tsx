'use client';
/**
 * Feature module mounts. `FeatureLayers` mounts each module's Layer while any of its layers is
 * active (behind the map's start-up admission queue). `FeatureBackgrounds` mounts every module's
 * Background (route planner, DRAW/ROUTE/ARCGIS overlays) as soon as the map is usable: they serve
 * the user's own clicks and must not wait for the data layers. Owner: map-engine.
 */
import { useMemo } from 'react';
import { modulesForLayers, FEATURE_MODULES } from '@/features/registry';
import { useUiStore } from '@/lib/store';

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
