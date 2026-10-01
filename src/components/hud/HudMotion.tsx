'use client';
/**
 * The animated HUD parts — layer rail (flyouts), view strip (segmented highlight), panel host and
 * card host — each inside a motion scope. HudRoot loads this module with next/dynamic after
 * hydration (behind the boot splash), so motion never ships in the first-load bundle (perf m-d).
 * Settings → motion overrides the system preference here (REDUCED / FULL); SYSTEM keeps
 * `reducedMotion="user"`. motion's feature bundle itself is a further lazy chunk (motion-features).
 * Owner: design-system-hud.
 */
import { LazyMotion, MotionConfig } from 'motion/react';
import type { ReactNode } from 'react';
import CardHost from '@/components/cards/CardHost';
import { useUiStore } from '@/lib/store';
import LayerRail from './LayerRail';
import PanelHost from './PanelHost';
import ViewControls from './ViewControls';

const loadMotionFeatures = () => import('./motion-features').then((mod) => mod.default);

/** Settings → motion as motion's `reducedMotion` (SYSTEM = follow the OS preference). */
export function reducedMotionFor(pref: string): 'always' | 'never' | 'user' {
  return pref === 'reduced' ? 'always' : pref === 'full' ? 'never' : 'user';
}

export function MotionScope({ children }: { children: ReactNode }) {
  const pref = useUiStore((s) => s.settings.motion);
  return (
    <MotionConfig reducedMotion={reducedMotionFor(pref)}>
      <LazyMotion features={loadMotionFeatures}>{children}</LazyMotion>
    </MotionConfig>
  );
}

export function LayerRailMotion() {
  return (
    <MotionScope>
      <LayerRail />
    </MotionScope>
  );
}

export function ViewControlsMotion() {
  return (
    <MotionScope>
      <ViewControls />
    </MotionScope>
  );
}

export function PanelHostMotion() {
  return (
    <MotionScope>
      <PanelHost />
    </MotionScope>
  );
}

export function CardHostMotion() {
  return (
    <MotionScope>
      <CardHost />
    </MotionScope>
  );
}
