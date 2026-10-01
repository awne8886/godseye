'use client';
/**
 * Dated REFERENCE chips for the imagery on screen (Black Marble 2016, the GIBS mosaic day, Esri
 * World Imagery) and the terrain status line, stacked by MapLibre above the attribution control
 * (bottom-right) so they never overlap HUD chrome. Plain text only. `data-tone` (hud chip-tone):
 * a source that is down (BASEMAP OFFLINE, terrain unavailable) takes the alert tone. Owner: map-engine.
 */
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useControl } from 'react-map-gl/maplibre';
import type { IControl } from 'maplibre-gl';
import { imageryChipTone } from '@/components/hud/chip-tone';

export interface ImageryChip {
  id: string;
  text: string;
}

class ChipControl implements IControl {
  readonly el: HTMLDivElement;
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'maplibregl-ctrl godseye-imagery-chips';
  }
  onAdd() {
    return this.el;
  }
  onRemove() {
    this.el.remove();
  }
}

export default function ImageryChips({ chips }: { chips: readonly ImageryChip[] }) {
  const [control] = useState(() => new ChipControl());
  useControl(() => control, { position: 'bottom-right' });
  if (!chips.length) return null;
  return createPortal(
    <ul aria-label="Imagery on the map" className="flex flex-col items-end gap-1">
      {chips.map((c) => (
        <li
          key={c.id}
          data-testid={`imagery-chip-${c.id}`}
          data-tone={imageryChipTone(c)}
          className="hud-micro rounded-md border border-[var(--border-primary)] bg-[var(--bg-panel)] px-2 py-0.5 text-[var(--text-secondary)]"
        >
          {c.text}
        </li>
      ))}
    </ul>,
    control.el,
  );
}
