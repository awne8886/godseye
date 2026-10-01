'use client';
/**
 * Everything the HUD draws above the map: overlays, header, telemetry, rails, tool strip, panels,
 * cards, status bar, splash, palette, key handler, mobile shell. The app shell mounts only this.
 * Settings → motion overrides the system preference here (REDUCED / FULL); SYSTEM defers to the
 * lead's <MotionConfig reducedMotion="user">. Owner: design-system-hud.
 */
import { LazyMotion, MotionConfig } from 'motion/react';
import CardHost from '@/components/cards/CardHost';
import { useUiStore } from '@/lib/store';
import Boot from './Boot';
import Header from './Header';
import KeyHandler from './KeyHandler';
import LayerRail from './LayerRail';
import MobileNav from './MobileNav';
import Overlays from './Overlays';
import PanelHost from './PanelHost';
import Splash from './Splash';
import StatusBar from './StatusBar';
import Telemetry from './Telemetry';
import ThemeSync from './ThemeSync';
import ToolStrip from './ToolStrip';
import ViewControls from './ViewControls';

/** motion's feature bundle loads after first paint (perf m4); HUD components use the light `m.` elements. */
const loadMotionFeatures = () => import('./motion-features').then((mod) => mod.default);

export default function HudRoot() {
  const motionPref = useUiStore((s) => s.settings.motion);
  const reducedMotion = motionPref === 'reduced' ? 'always' : motionPref === 'full' ? 'never' : 'user';
  return (
    <MotionConfig reducedMotion={reducedMotion}>
      <LazyMotion features={loadMotionFeatures}>
      <ThemeSync />
      <KeyHandler />
      <Boot />
      <Overlays />
      <Header />
      <Telemetry />
      <LayerRail />
      <ToolStrip />
      <ViewControls />
      <PanelHost />
      <CardHost />
      <StatusBar />
      <MobileNav />
      <Splash />
      </LazyMotion>
    </MotionConfig>
  );
}
