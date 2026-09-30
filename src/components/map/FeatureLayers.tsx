'use client';
/** Mounts each feature module's Layer component while any of its layers is active. Owner: map-engine. */
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
      {FEATURE_MODULES.filter((m) => m.Background).map((m) => {
        const B = m.Background!;
        return <B key={`${m.id}:bg`} />;
      })}
    </>
  );
}
