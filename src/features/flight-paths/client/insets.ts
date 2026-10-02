'use client';
/**
 * HUD chrome over the map, measured from the live DOM at framing time (round 3b R3-m5/R3-m9 and
 * their round-4 remainders): every element marked `[data-map-inset]`, plus the HUD chrome and
 * MapLibre controls found by selector — header block, telemetry, layer rail, tool strip, pinned
 * column, readout row, status bar, phone bottom nav and sheet, each imagery/basemap chip and the
 * attribution. The phone sheet also counts at its final height (`--sheet-occupied`, published by
 * PanelHost, else its CSS bound) while it is still sliding in. Client-only.
 */
import { PHONE_LAYOUT_QUERY } from '@/lib/map/view';
import { PHONE_MAX_WIDTH, type Rect, type Viewport } from './framing';

/** Mobile nav height under the sheet (PanelHost: `bottom: calc(56px + safe-area)`). */
const MOBILE_NAV_PX = 56;
/** Sheet CSS bound (`max-h-[55vh]`): the PATHS panel content always reaches it. */
const SHEET_MAX_SHARE = 0.55;

/**
 * Every overlay that can cover the map. `[data-map-inset]` is the contract for HUD chrome; the
 * selectors after it cover chrome (and MapLibre's control corners) that does not carry it yet.
 * Imagery chips are measured one by one: the stack's box is as wide as its widest chip.
 */
export const MAP_INSET_SELECTORS = [
  '[data-map-inset]',
  'header.fixed',
  '[aria-label="Telemetry"]',
  'nav[aria-label="Map layers"]',
  'nav[aria-label="Tools"]',
  '[aria-label="Pinned panels"]',
  '[data-readout-row]',
  'footer.fixed',
  'nav[aria-label="Main"]',
  '[data-testid="mobile-sheet"]',
  '.godseye-imagery-chips li',
  '.maplibregl-ctrl-top-left > *',
  '.maplibregl-ctrl-top-right > *',
  '.maplibregl-ctrl-bottom-left > :not(.godseye-imagery-chips)',
  '.maplibregl-ctrl-bottom-right > :not(.godseye-imagery-chips)',
] as const;

/** The HUD's phone layout (bottom sheet, no docked panel): same query as the HUD and MapView. */
export function isPhoneLayout(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia === 'function') return window.matchMedia(PHONE_LAYOUT_QUERY).matches;
  return window.innerWidth < PHONE_MAX_WIDTH;
}

/** Height covered from the viewport bottom by the phone sheet: published value, else the CSS bound. */
export function sheetOccupiedPx(published: string, viewportHeight: number): number {
  const v = Number.parseFloat(published);
  if (Number.isFinite(v) && v > 0) return v;
  return Math.round(MOBILE_NAV_PX + viewportHeight * SHEET_MAX_SHARE);
}

/** The sheet as a full-width bottom obstacle. */
export function sheetRect(viewport: Viewport, occupied: number): Rect {
  return { left: 0, top: viewport.height - occupied, right: viewport.width, bottom: viewport.height };
}

/** The published `--sheet-occupied` value (empty when no sheet is open). */
export function publishedSheet(): string {
  return typeof document === 'undefined' ? '' : document.documentElement.style.getPropertyValue('--sheet-occupied');
}

const toRect = (r: DOMRect): Rect => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });

/** The elements matched by `MAP_INSET_SELECTORS` (laid out or not). */
export function overlayElements(root: ParentNode = document): HTMLElement[] {
  return [...root.querySelectorAll(MAP_INSET_SELECTORS.join(','))].filter((el): el is HTMLElement => el instanceof HTMLElement);
}

/**
 * Every chrome box over the map right now. Phones include the sheet at its final height while a
 * panel is open or about to open (`sheet`, default true: PATHS opens with every new route).
 */
export function measureObstacles({ sheet = true }: { sheet?: boolean } = {}): Rect[] {
  if (typeof window === 'undefined' || typeof document === 'undefined') return [];
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const out: Rect[] = [];
  for (const el of overlayElements()) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    if (r.right <= 0 || r.bottom <= 0 || r.left >= viewport.width || r.top >= viewport.height) continue;
    if (getComputedStyle(el).visibility === 'hidden') continue;
    out.push(toRect(r));
  }
  if (sheet && isPhoneLayout()) out.push(sheetRect(viewport, sheetOccupiedPx(publishedSheet(), viewport.height)));
  return out;
}
