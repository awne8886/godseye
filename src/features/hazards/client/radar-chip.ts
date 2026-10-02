/**
 * The weather-radar frame-time chip lives in MapLibre's bottom-right control stack, the same stack
 * as the dated imagery chips (BLACK MARBLE, GIBS) and the attribution (visual-qa round 4 M2). That
 * stack is placed by the HUD's safe areas (base.css: above the desktop status bar; on phones above
 * the bottom nav, an open sheet and an entity card) and stacks its controls without overlap, so the
 * radar's only observed time is never covered by the attribution, the nav, the rail, the imagery
 * chips or the readout/hint row. The control also marks itself `data-map-inset`, so map framing
 * (flight paths) keeps endpoints out from under it. Owner: layers-hazards. Client-only.
 */
import type { IControl } from 'maplibre-gl';

/** Corner the chip stacks into (with the imagery chips and the attribution). */
export const RADAR_CHIP_POSITION = 'bottom-right' as const;

/** "RADAR · RAINVIEWER · 2026-10-01 06:10 UTC" for a frame's observed ISO time. */
export function radarFrameLabel(timeIso: string): string {
  const iso = new Date(timeIso).toISOString();
  return `RADAR · RAINVIEWER · ${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/**
 * A bare MapLibre control: an element the chip is portalled into. Pointer events pass through to
 * the map (the chip is a read-out, not a control).
 */
export class RadarChipControl implements IControl {
  readonly el: HTMLDivElement;
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'maplibregl-ctrl godseye-radar-chip';
    this.el.dataset.mapInset = 'radar-frame';
    this.el.style.pointerEvents = 'none';
  }
  onAdd(): HTMLElement {
    return this.el;
  }
  onRemove(): void {
    this.el.remove();
  }
}
