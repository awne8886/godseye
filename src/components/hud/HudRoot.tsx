'use client';
/**
 * Everything the HUD draws above the map: overlays, header, telemetry, rails, tool strip, panels,
 * cards, status bar, splash, palette, key handler, mobile shell. The app shell mounts only this.
 * First paint is motion-free (perf m-d): the parts that animate with motion (layer rail flyouts,
 * view strip, panel host, card host) load from one chunk right after hydration, while the boot
 * splash still covers the screen, each inside its own MotionConfig + LazyMotion scope
 * (HudMotion.tsx; Settings → motion REDUCED / FULL / SYSTEM = reducedMotion "user").
 * Owner: design-system-hud.
 */
import dynamic from 'next/dynamic';
import Boot from './Boot';
import Header from './Header';
import KeyHandler from './KeyHandler';
import MobileNav from './MobileNav';
import Overlays from './Overlays';
import Splash from './Splash';
import StatusBar from './StatusBar';
import Telemetry from './Telemetry';
import ThemeSync from './ThemeSync';
import ToolStrip from './ToolStrip';

const LayerRail = dynamic(() => import('./HudMotion').then((mod) => mod.LayerRailMotion), { ssr: false });
const ViewControls = dynamic(() => import('./HudMotion').then((mod) => mod.ViewControlsMotion), { ssr: false });
const PanelHost = dynamic(() => import('./HudMotion').then((mod) => mod.PanelHostMotion), { ssr: false });
const CardHost = dynamic(() => import('./HudMotion').then((mod) => mod.CardHostMotion), { ssr: false });

export default function HudRoot() {
  return (
    <>
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
    </>
  );
}
