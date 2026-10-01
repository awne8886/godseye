'use client';
/**
 * HUD chrome that covers the map, measured at fit time for the route framing (round 3b, R3-m5 /
 * R3-m9): the phone bottom sheet (the `--sheet-occupied` height PanelHost publishes on <html>,
 * else its CSS bound), MapLibre's bottom control corners (the attribution is lifted above the
 * sheet on phones) and the view-controls bar (bottom-left on desktop, top-left on phones).
 * Measured from the live DOM, so a moved control is still respected. Client-only.
 */
import type { Rect } from './layers';

/** Phone layout breakpoint (Tailwind `md`). */
export const PHONE_MAX_WIDTH = 768;
/** Mobile nav height under the sheet (PanelHost: `bottom: calc(56px + safe-area)`). */
const MOBILE_NAV_PX = 56;
/** Sheet CSS bound (`max-h-[55vh]`): the PATHS panel content always reaches it. */
const SHEET_MAX_SHARE = 0.55;

/** Height covered from the viewport bottom by the phone sheet: published value, else the CSS bound. */
export function sheetOccupiedPx(published: string, viewportHeight: number): number {
  const v = Number.parseFloat(published);
  if (Number.isFinite(v) && v > 0) return v;
  return Math.round(MOBILE_NAV_PX + viewportHeight * SHEET_MAX_SHARE);
}

/** The sheet as a full-width bottom obstacle. */
export function sheetRect(viewport: { width: number; height: number }, occupied: number): Rect {
  return { left: 0, top: viewport.height - occupied, right: viewport.width, bottom: viewport.height };
}

const toRect = (r: DOMRect): Rect => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });

/** Every chrome box over the map right now (phones include the sheet, open or about to open). */
export function measureObstacles(): Rect[] {
  if (typeof window === 'undefined' || typeof document === 'undefined') return [];
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const out: Rect[] = [];
  if (viewport.width < PHONE_MAX_WIDTH) {
    const published = document.documentElement.style.getPropertyValue('--sheet-occupied');
    out.push(sheetRect(viewport, sheetOccupiedPx(published, viewport.height)));
  }
  // The view-controls bar is the glass panel holding the Projection toggle.
  const controls = document.querySelector('[role="group"][aria-label="Projection"]')?.closest('.glass-panel');
  const boxes = [controls, ...document.querySelectorAll('.maplibregl-ctrl-bottom-left > *, .maplibregl-ctrl-bottom-right > *')];
  for (const el of boxes) {
    if (!(el instanceof HTMLElement)) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) out.push(toRect(r));
  }
  return out;
}
