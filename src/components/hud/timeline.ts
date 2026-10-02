'use client';
/**
 * 24 h timeline scrubber state and filter (§7, §9 item 2). The cursor lives in the UI store
 * (`timeCursor`, null = live); the replayable layers (earthquakes, fires, alert pins, GDELT events)
 * draw only items whose OBSERVED time is at or before the cursor and inside the 24 h before it.
 * Nothing is interpolated or invented: an item without an observed time is never placed on the
 * timeline, and each layer reports the span its feed actually holds (`useReportCoverage`), which the
 * scrubber shows; time outside that span is greyed out. Owner: design-system-hud.
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import { useUiStore } from '@/lib/store';

export const TIMELINE_SPAN_MS = 24 * 3_600_000;
/** Arrow-key step and the drag snap. */
export const TIMELINE_STEP_MS = 15 * 60_000;
/** Shift+Arrow / PageUp / PageDown step. */
export const TIMELINE_BIG_STEP_MS = 3_600_000;

export const TIMELINE_LAYERS = ['earthquakes', 'fires', 'alert_pins', 'gdelt_events'] as const;
export type TimelineLayer = (typeof TIMELINE_LAYERS)[number];
export const isTimelineLayer = (id: string): id is TimelineLayer => (TIMELINE_LAYERS as readonly string[]).includes(id);

export const TIMELINE_LABEL: Record<TimelineLayer, string> = { earthquakes: 'QUAKES', fires: 'FIRES', alert_pins: 'ALERTS', gdelt_events: 'GDELT' };

/** Epoch ms of an ISO time, or null when absent/unparseable. */
export function timeMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** True when an item observed at `observedMs` is shown at `cursor` (null = live: everything held). */
export function inReplayWindow(observedMs: number | null, cursor: number | null): boolean {
  if (cursor === null) return true;
  if (observedMs === null || !Number.isFinite(observedMs)) return false;
  return observedMs <= cursor && observedMs > cursor - TIMELINE_SPAN_MS;
}

/** The items shown at `cursor`; the same array (identity kept) when live. */
export function filterAtCursor<T>(items: readonly T[], cursor: number | null, observedMs: (t: T) => number | null): readonly T[] {
  if (cursor === null) return items;
  return items.filter((t) => inReplayWindow(observedMs(t), cursor));
}

/** A cursor kept inside [now − 24 h, now); at or past now it is live (null). */
export function clampCursor(cursor: number | null, now: number): number | null {
  if (cursor === null || !Number.isFinite(cursor) || cursor >= now) return null;
  return Math.max(now - TIMELINE_SPAN_MS, cursor);
}

/** Moves the cursor by `deltaMs` (negative = back). Stepping back from live starts at now. */
export function stepCursor(cursor: number | null, now: number, deltaMs: number): number | null {
  return clampCursor((cursor ?? now) + deltaMs, now);
}

/** The cursor for a pointer at `fraction` (0 = 24 h ago, 1 = now) of the track, snapped to 15 min back from now. */
export function cursorAtFraction(fraction: number, now: number): number | null {
  const f = Math.min(1, Math.max(0, fraction));
  const back = Math.round(((1 - f) * TIMELINE_SPAN_MS) / TIMELINE_STEP_MS) * TIMELINE_STEP_MS;
  return back === 0 ? null : clampCursor(now - back, now);
}

/** Position (0..1) of `t` on the track ending at `now`. */
export function fractionOf(t: number, now: number): number {
  return Math.min(1, Math.max(0, 1 - (now - t) / TIMELINE_SPAN_MS));
}

export const hhmmUtc = (t: number) => new Date(t).toISOString().slice(11, 16);

/** Header / layer-row wording while scrubbing; never LIVE. */
export const replayLabel = (cursor: number) => `REPLAY ${hhmmUtc(cursor)} UTC`;

function agoText(ms: number): string {
  const min = Math.round(ms / 60_000);
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} h${m ? ` ${m} min` : ''} ago` : `${m} min ago`;
}

/** aria-valuetext of the slider. */
export function cursorValueText(cursor: number | null, now: number): string {
  if (cursor === null) return 'Live, now';
  return `Replay ${new Date(cursor).toISOString().slice(0, 16).replace('T', ' ')} UTC, ${agoText(now - cursor)}`;
}

/** What a layer's feed holds (epoch ms), and how many items it draws at the cursor of how many held. */
export interface Coverage {
  from: number;
  to: number;
  shown: number;
  total: number;
}

interface CoverageState {
  coverage: Partial<Record<TimelineLayer, Coverage>>;
  report: (layer: TimelineLayer, c: Coverage | null) => void;
}

/** Per-poll span per layer (changes on a poll or a cursor move, never per frame). */
export const useTimelineCoverage = create<CoverageState>()((set) => ({
  coverage: {},
  report: (layer, c) =>
    set((s) => {
      const prev = s.coverage[layer];
      if (!c) {
        if (!prev) return s;
        const next = { ...s.coverage };
        delete next[layer];
        return { coverage: next };
      }
      if (prev && prev.from === c.from && prev.to === c.to && prev.shown === c.shown && prev.total === c.total) return s;
      return { coverage: { ...s.coverage, [layer]: c } };
    }),
}));

/** Publishes a layer's held span (null while it holds nothing, e.g. SOURCE OFFLINE) and clears it on unmount. */
export function useReportCoverage(layer: TimelineLayer, c: Coverage | null): void {
  const report = useTimelineCoverage((s) => s.report);
  const { from, to, shown, total } = c ?? { from: NaN, to: NaN, shown: 0, total: 0 };
  const has = c !== null;
  useEffect(() => {
    report(layer, has ? { from, to, shown, total } : null);
  }, [report, layer, has, from, to, shown, total]);
  useEffect(() => () => report(layer, null), [report, layer]);
}

/** The scrubber cursor (null = live). */
export const useTimeCursor = () => useUiStore((s) => s.timeCursor);

/**
 * The span a feed holds: its declared window ending at the fetch (`windowMs`), or, when the feed
 * declares none, from its oldest observed item to the fetch. null when there is no fetch time.
 */
export function heldSpan(fetchedAt: string | null | undefined, windowMs: number | null, oldestObservedMs: number | null): { from: number; to: number } | null {
  const to = timeMs(fetchedAt);
  if (to === null) return null;
  if (windowMs !== null) return { from: to - windowMs, to };
  return oldestObservedMs === null ? null : { from: Math.min(oldestObservedMs, to), to };
}

/** Oldest observed time among items (null when none carries one). */
export function oldestMs<T>(items: readonly T[], observedMs: (t: T) => number | null): number | null {
  let min: number | null = null;
  for (const it of items) {
    const t = observedMs(it);
    if (t !== null && (min === null || t < min)) min = t;
  }
  return min;
}
