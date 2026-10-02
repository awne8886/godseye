'use client';
/**
 * Dated REFERENCE chips for the imagery on screen (Black Marble 2016, the GIBS mosaic day, Esri
 * World Imagery) and the terrain status line, stacked by MapLibre above the attribution control
 * (bottom-right) so they never overlap HUD chrome. Plain text only. `data-tone` (hud chip-tone):
 * a source that is down (BASEMAP OFFLINE, terrain unavailable) takes the alert tone; a chip may
 * set its own tone (an imagery overlay with holes is degraded, BASEMAP LOADING before the first
 * painted frame is not).
 *
 * Phone layout (`collapse`, verification round 8): two or more chips fold into ONE summary chip —
 * the worst chip's text (a source that is down first) and how many more there are, in the worst
 * tone — which a tap expands to the full list (and folds back). On a landscape phone with a sheet
 * open the full stack ran up under the view bar and hid the attribution. Owner: map-engine.
 */
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useControl } from 'react-map-gl/maplibre';
import type { IControl } from 'maplibre-gl';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { type ChipTone, imageryChipTone } from '@/components/hud/chip-tone';

export interface ImageryChip {
  id: string;
  text: string;
  /** Overrides the tone derived from id/text (`imageryChipTone`). */
  tone?: ChipTone;
}

const toneOf = (c: ImageryChip): ChipTone => c.tone ?? imageryChipTone(c);

/** The folded stack: the worst chip leads (alert tone first, else the first chip) and the rest are counted. */
export function summarizeChips(chips: readonly ImageryChip[]): { lead: ImageryChip; tone: ChipTone; more: number } | null {
  if (!chips.length) return null;
  const lead = chips.find((c) => toneOf(c) === 'offline') ?? chips[0]!;
  return { lead, tone: toneOf(lead), more: chips.length - 1 };
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

const CHIP = 'hud-micro rounded-md border border-[var(--border-primary)] bg-[var(--bg-panel)] px-2 py-0.5 text-[var(--text-secondary)]';

export default function ImageryChips({ chips, collapse = false }: { chips: readonly ImageryChip[]; collapse?: boolean }) {
  const [control] = useState(() => new ChipControl());
  const [expanded, setExpanded] = useState(false);
  useControl(() => control, { position: 'bottom-right' });
  if (!chips.length) return null;
  const summary = collapse && chips.length > 1 ? summarizeChips(chips) : null;
  const toggle = summary ? (
    <li key="summary" data-map-inset="imagery-chip" className="flex justify-end">
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={expanded ? `Hide the ${chips.length} imagery notes` : `Imagery on the map: ${summary.lead.text} and ${summary.more} more. Show all`}
        onClick={() => setExpanded((v) => !v)}
        className="flex min-h-11 items-center bg-transparent p-0"
      >
        <span data-testid="imagery-chip-summary" data-tone={summary.tone} className={`${CHIP} inline-flex items-center gap-1`}>
          {expanded ? (
            <>
              <ChevronDown size={11} aria-hidden />
              HIDE
            </>
          ) : (
            <>
              <ChevronUp size={11} aria-hidden />
              {summary.lead.text}
              <span className="text-[var(--text-muted)]">{`+${summary.more}`}</span>
            </>
          )}
        </span>
      </button>
    </li>
  ) : null;
  const items = !summary || expanded ? chips : [];
  return createPortal(
    <ul aria-label="Imagery on the map" className="flex flex-col items-end gap-1">
      {items.map((c) => (
        <li key={c.id} data-testid={`imagery-chip-${c.id}`} data-map-inset="imagery-chip" data-tone={toneOf(c)} className={CHIP}>
          {c.text}
        </li>
      ))}
      {toggle}
    </ul>,
    control.el,
  );
}
