'use client';
/**
 * Everything the HUD draws above the map: overlays, header, telemetry, rails, tool strip, panels,
 * cards, status bar, splash, palette, key handler, mobile shell. The app shell mounts only this.
 * Owner: design-system-hud.
 */
import Header from './Header';
import LayerRail from './LayerRail';
import Overlays from './Overlays';
import Splash from './Splash';
import StatusBar from './StatusBar';
import Telemetry from './Telemetry';
import ViewControls from './ViewControls';

export default function HudRoot() {
  return (
    <>
      <Overlays />
      <Header />
      <Telemetry />
      <LayerRail />
      <ViewControls />
      <StatusBar />
      <Splash />
    </>
  );
}
