'use client';
/**
 * Dated REFERENCE chips for the imagery on screen (Black Marble 2016, the GIBS mosaic day, Esri
 * World Imagery) and the terrain status line, stacked by MapLibre above the attribution control
 * (bottom-right) so they never overlap HUD chrome. Plain text only. `data-tone` (hud chip-tone):
 * a source that is down (BASEMAP OFFLINE, terrain unavailable) takes the alert tone; a chip may
 * set its own tone (an imagery overlay with holes is degraded, BASEMAP LOADING before the first
 * painted frame is not). Owner: map-engine.
 */
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useControl } from 'react-map-gl/maplibre';
import type { IControl } from 'maplibre-gl';
import { type ChipTone, imageryChipTone } from '@/components/hud/chip-tone';

export interface ImageryChip {
  id: string;
  text: string;
  /** Overrides the tone derived from id/text (`imageryChipTone`). */
  tone?: ChipTone;
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
          data-map-inset="imagery-chip"
          data-tone={c.tone ?? imageryChipTone(c)}
          className="hud-micro rounded-md border border-[var(--border-primary)] bg-[var(--bg-panel)] px-2 py-0.5 text-[var(--text-secondary)]"
        >
          {c.text}
        </li>
      ))}
    </ul>,
    control.el,
  );
}
