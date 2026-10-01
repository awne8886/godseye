'use client';
/**
 * The map area until the basemap style is parsed (before MapLibre exists, and over the map while
 * it is constructed and loads the style): the same
 * BASEMAP LOADING chip the map shows until its first painted frame, where the chip stack will be
 * (bottom-right, above the attribution / phone nav). Visual-qa round-4 m7 / round-5 m3: never a
 * blank map with no word for the first seconds. Plain text, tokens only. Owner: map-engine.
 */
import { basemapChipText } from '@/lib/map/basemap-health';

const TEXT = basemapChipText({ state: 'loading', lastGoodAt: null, retryInMs: null, missing: 0 })!;

/**
 * Where MapLibre's bottom-right stack puts the chip once the map has loaded: base.css control
 * offsets + the attribution credits + the chip control's 10 px margin, measured on the OpenFreeMap
 * style's credits (1600×1000 desktop: chip bottom 101 px; 390×844 phone: 144 px; visual-qa round-5
 * m3 gap.mjs). The overlay is shown until load, so the hand-over keeps the chip in place.
 */
const POSITION = {
  desktop: { right: '16px', bottom: '101px' },
  phone: { right: '10px', bottom: 'calc(144px + env(safe-area-inset-bottom))' },
} as const;

export default function BasemapPending({ phone }: { phone: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0" data-testid="map-pending" data-basemap-state="loading">
      <ul aria-label="Imagery on the map" className="godseye-imagery-chips absolute z-[5] flex flex-col items-end gap-1" style={phone ? POSITION.phone : POSITION.desktop}>
        <li
          data-testid="imagery-chip-basemap-loading"
          data-map-inset="imagery-chip"
          data-tone="reference"
          className="hud-micro rounded-md leading-5 border border-[var(--border-primary)] bg-[var(--bg-panel)] px-2 py-0.5 text-[var(--text-secondary)]"
        >
          {TEXT}
        </li>
      </ul>
    </div>
  );
}
