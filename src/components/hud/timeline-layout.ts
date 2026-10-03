'use client';
/**
 * Where the desktop timeline strip goes so it never covers MapLibre's bottom-right stack (the
 * imagery honesty chips and the licence credits; r11 MAJOR: at 1024–1400 px the strip hid the
 * NIGHT LIGHTS / BASEMAP LOADING chips and the first credits line, and pushed LIVE off screen).
 * The strip keeps its slot right of the view strip and ends before the stack when that leaves it
 * room for its header; otherwise it rises above the stack's top edge. Phones use base.css instead
 * (the stack rides above the compact bar). Owner: design-system-hud.
 */
import { useLayoutEffect, useState } from 'react';

export interface StripPlacement {
  /** slot: no stack measured; beside: ends before the stack; above: rises over the stack's top. */
  mode: 'slot' | 'beside' | 'above';
  left: number;
  bottom: number;
  width: number;
}

/** A viewport rectangle (DOMRect-like). */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Default slots, mirrored by TimelineScrubber's classes (first paint, before the stack is measured). */
const WIDE = { left: 512, bottom: 56, maxWidth: 620, rightMargin: 80 } as const;
const NARROW = { left: 120, bottom: 148, maxWidth: 560, rightMargin: 80 } as const;
/** Below this the header (label, time, LIVE) and two count columns no longer fit beside the stack. */
export const STRIP_MIN_SIDE_WIDTH = 400;
/** Clear space kept between the strip and the stack. */
export const STRIP_STACK_GAP = 8;

/** Pure placement for a `vw`×`vh` viewport and the stack's box (null while there is no stack). */
export function stripPlacement(vw: number, vh: number, stack: Box | null): StripPlacement {
  const slot = vw >= 1024 ? WIDE : NARROW;
  const width = Math.max(0, Math.min(slot.maxWidth, vw - slot.left - slot.rightMargin));
  if (!stack || stack.right <= stack.left || stack.bottom <= stack.top) return { mode: 'slot', left: slot.left, bottom: slot.bottom, width };
  const beside = Math.min(width, Math.floor(stack.left - STRIP_STACK_GAP - slot.left));
  if (beside >= STRIP_MIN_SIDE_WIDTH) return { mode: 'beside', left: slot.left, bottom: slot.bottom, width: beside };
  return { mode: 'above', left: slot.left, bottom: Math.max(slot.bottom, Math.ceil(vh - stack.top + STRIP_STACK_GAP)), width };
}

const STACK = '.maplibregl-map .maplibregl-ctrl-bottom-right';
/** How often to look for a (re)created map stack; its size changes are observed directly. */
const STACK_POLL_MS = 2_000;

const samePlacement = (a: StripPlacement | null, b: StripPlacement) => !!a && a.mode === b.mode && a.left === b.left && a.bottom === b.bottom && a.width === b.width;

/**
 * The measured placement while `on` (desktop layout with the strip shown), null otherwise. Follows
 * the stack's size (chips appearing, credits changing with the basemap) and the viewport.
 */
export function useStripPlacement(on: boolean): StripPlacement | null {
  const [placement, setPlacement] = useState<StripPlacement | null>(null);
  useLayoutEffect(() => {
    if (!on) return;
    let observed: Element | null = null;
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure());
    function measure() {
      const stack = document.querySelector(STACK);
      if (stack !== observed) {
        if (observed) ro?.unobserve(observed);
        if (stack) ro?.observe(stack);
        observed = stack;
      }
      const r = stack?.getBoundingClientRect() ?? null;
      const next = stripPlacement(window.innerWidth, window.innerHeight, r);
      setPlacement((prev) => (samePlacement(prev, next) ? prev : next));
    }
    measure();
    const poll = setInterval(measure, STACK_POLL_MS);
    window.addEventListener('resize', measure);
    return () => {
      clearInterval(poll);
      window.removeEventListener('resize', measure);
      ro?.disconnect();
    };
  }, [on]);
  return on ? placement : null;
}
