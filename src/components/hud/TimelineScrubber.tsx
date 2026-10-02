'use client';
/**
 * 24 h timeline scrubber (§7, §9 item 2): a bottom strip (desktop: above the status bar, the cursor
 * readout and the map credits, right of the view strip; narrow desktops: above the view strip;
 * phones: a one-row bar above the bottom nav, hidden while a sheet or card covers it) that drives the UI
 * store's `timeCursor` (null = live). One lane per active replayable layer shows the span its feed
 * actually holds; the rest of the 24 h is hatched as NOT HELD. The cursor's UTC time is the strip's
 * headline; while scrubbing it reads REPLAY hh:mm UTC, never LIVE. Keyboard (slider focused):
 * ←/→ 15 min, Shift+←/→ or PageUp/PageDown 1 h, Home = 24 h ago, End or Escape = live.
 * Loaded with next/dynamic after hydration (HudRoot), so it costs nothing on first paint.
 * Owner: design-system-hud.
 */
import { Radio } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { LayerId } from '@/lib/layer-registry';
import { useUiStore } from '@/lib/store';
import { useIsMobile, useVisibleLayers } from './hooks';
import {
  TIMELINE_BIG_STEP_MS,
  TIMELINE_LABEL,
  TIMELINE_LAYERS,
  TIMELINE_SPAN_MS,
  TIMELINE_STEP_MS,
  clampCursor,
  cursorAtFraction,
  cursorValueText,
  fractionOf,
  hhmmUtc,
  stepCursor,
  useTimelineCoverage,
  type TimelineLayer,
} from './timeline';

const LANE_TOKEN: Record<TimelineLayer, string> = {
  earthquakes: 'var(--map-seismic)',
  fires: 'var(--map-fire)',
  alert_pins: 'var(--map-alert-event)',
  gdelt_events: 'var(--map-gdelt-4)',
};

/** The slider's value is minutes relative to now: −1440 (24 h ago) … 0 (now). */
const MIN_OFFSET_MIN = -(TIMELINE_SPAN_MS / 60_000);
/** Wall clock read in event handlers (not during render). */
const wallClock = () => Date.now();

/** Hour marks (hours before now) labelled under the track. */
const MARKS = [24, 18, 12, 6, 0] as const;

/** Wall clock for the track (minute resolution is plenty for a 24 h strip with 15 min steps). */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** While mounted on a phone, <html data-timeline-strip> lifts MapLibre's bottom stack above the bar (base.css). */
function usePhoneStripFlag(on: boolean) {
  useEffect(() => {
    if (!on) return;
    const root = document.documentElement;
    root.setAttribute('data-timeline-strip', '');
    return () => root.removeAttribute('data-timeline-strip');
  }, [on]);
}

/** Pure key → next cursor (undefined = key not handled). Exported for tests. */
export function cursorForKey(key: string, shift: boolean, cursor: number | null, now: number): number | null | undefined {
  const step = shift ? TIMELINE_BIG_STEP_MS : TIMELINE_STEP_MS;
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowDown':
      return stepCursor(cursor, now, -step);
    case 'ArrowRight':
    case 'ArrowUp':
      return stepCursor(cursor, now, step);
    case 'PageDown':
      return stepCursor(cursor, now, -TIMELINE_BIG_STEP_MS);
    case 'PageUp':
      return stepCursor(cursor, now, TIMELINE_BIG_STEP_MS);
    case 'Home':
      return clampCursor(now - TIMELINE_SPAN_MS, now);
    case 'End':
      return null;
    case 'Escape':
      return cursor === null ? undefined : null;
    default:
      return undefined;
  }
}

export default function TimelineScrubber() {
  const active = useUiStore((s) => s.activeLayers);
  const rawCursor = useUiStore((s) => s.timeCursor);
  const setCursor = useUiStore((s) => s.setTimeCursor);
  const coverage = useTimelineCoverage((s) => s.coverage);
  const visible = useVisibleLayers();
  const phone = useIsMobile();
  const now = useNow();
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const lanes = useMemo(() => {
    const ids = new Set(visible.map((l) => l.id));
    return TIMELINE_LAYERS.filter((id) => ids.has(id) && active.has(id as LayerId));
  }, [visible, active]);
  const shown = lanes.length > 0;
  usePhoneStripFlag(shown && phone);

  // A cursor that time has carried out of the strip is shown at its left edge.
  const cursor = clampCursor(rawCursor, now);
  const replaying = cursor !== null;

  // Leaving every replayable layer ends the replay (nothing left to scrub).
  useEffect(() => {
    if (!shown && rawCursor !== null) setCursor(null);
  }, [shown, rawCursor, setCursor]);

  if (!shown) return null;

  const offsetMin = replaying ? -Math.round((now - cursor) / 60_000) : 0;
  const cursorPct = replaying ? fractionOf(cursor, now) * 100 : 100;

  const fromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const r = track.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return;
    setCursor(cursorAtFraction((e.clientX - r.left) / r.width, wallClock()));
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    dragging.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.currentTarget.focus();
    fromPointer(e);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) fromPointer(e);
  };
  const endDrag = () => {
    dragging.current = false;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = cursorForKey(e.key, e.shiftKey, cursor, wallClock());
    if (next === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    setCursor(next);
  };

  const headline = replaying ? `REPLAY ${hhmmUtc(cursor)} UTC` : `NOW ${hhmmUtc(now)} UTC`;
  return (
    <section
      aria-label="Timeline, last 24 hours"
      data-testid="timeline-scrubber"
      data-replay={replaying ? 'true' : 'false'}
      data-map-inset="timeline"
      className="glass-panel hud-timeline fixed bottom-[56px] left-[512px] z-[var(--z-hud)] flex w-[min(620px,calc(100vw-592px))] flex-col gap-1 px-3 py-1.5 max-lg:bottom-[148px] max-lg:left-[120px] max-lg:w-[min(560px,calc(100vw-200px))] phone:left-2 phone:flex-row phone:items-center phone:gap-2 phone:bottom-[calc(57px+env(safe-area-inset-bottom)+4px)] phone:w-[calc(100vw-16px)] phone:px-2 phone:py-1"
    >
      <div className="flex items-center gap-3 phone:contents">
        <span className="hud-micro text-[var(--text-secondary)] phone:hidden">TIMELINE · 24 H</span>
        <span
          data-testid="timeline-time"
          aria-live="polite"
          className="whitespace-nowrap font-mono text-[13px] font-bold uppercase tabular-nums tracking-[0.08em] phone:order-1 phone:text-[11px]"
          style={{ color: replaying ? 'var(--gold-light)' : 'var(--cyan-primary)' }}
        >
          {headline}
        </span>
        <span className="flex-1 phone:hidden" />
        <ul className="flex items-center gap-2 phone:hidden" aria-label="Items drawn at the cursor">
          {lanes.map((id) => {
            const c = coverage[id];
            return (
              <li key={id} data-testid={`timeline-count-${id}`} data-shown={c?.shown ?? ''} data-total={c?.total ?? ''} className="hud-micro tabular-nums text-[var(--text-secondary)]">
                <span aria-hidden className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: LANE_TOKEN[id] }} />
                {TIMELINE_LABEL[id]} {c ? (replaying ? `${c.shown.toLocaleString('en-US')}/${c.total.toLocaleString('en-US')}` : c.total.toLocaleString('en-US')) : '—'}
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          aria-pressed={!replaying}
          onClick={() => setCursor(null)}
          title={replaying ? 'Return to live (End or Escape)' : 'Showing live data'}
          className="hud-control hud-micro flex min-h-[24px] items-center gap-1 rounded-[var(--radius-chip)] border px-2 phone:order-3 phone:min-h-11 phone:min-w-11 phone:justify-center"
          style={{ borderColor: replaying ? 'var(--border-active)' : 'var(--alert-green)', color: replaying ? 'var(--gold-light)' : 'var(--alert-green)' }}
        >
          <Radio size={12} aria-hidden />
          LIVE
        </button>
      </div>
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label="Timeline cursor"
        aria-valuemin={MIN_OFFSET_MIN}
        aria-valuemax={0}
        aria-valuenow={offsetMin}
        aria-valuetext={cursorValueText(cursor, now)}
        aria-orientation="horizontal"
        data-testid="timeline-slider"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        className="hud-control relative min-h-[24px] cursor-pointer touch-none select-none rounded-[4px] phone:order-2 phone:min-h-11 phone:min-w-0 phone:flex-1"
      >
        <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 flex-col gap-[3px]">
          {lanes.map((id) => {
            const c = coverage[id];
            const from = c ? fractionOf(c.from, now) * 100 : 0;
            const to = c ? fractionOf(c.to, now) * 100 : 0;
            return (
              <div key={id} className="hud-timeline-lane relative h-[3px] rounded-full" data-testid={`timeline-lane-${id}`} title={c ? `${TIMELINE_LABEL[id]}: feed holds ${hhmmUtc(c.from)}–${hhmmUtc(c.to)} UTC` : `${TIMELINE_LABEL[id]}: nothing held`}>
                {c && to > from && <div className="absolute inset-y-0 rounded-full" style={{ left: `${from}%`, width: `${to - from}%`, background: LANE_TOKEN[id] }} />}
              </div>
            );
          })}
        </div>
        {replaying && <div aria-hidden className="absolute inset-y-0 right-0 bg-[var(--bg-void)] opacity-60" style={{ left: `${cursorPct}%` }} />}
        <div aria-hidden className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-[var(--gold-light)] shadow-[0_0_6px_var(--gold-glow)]" style={{ left: `${cursorPct}%` }} />
      </div>
      <div aria-hidden className="relative h-3 phone:hidden">
        {MARKS.map((h) => (
          <span key={h} className="hud-micro absolute top-0 text-[var(--text-muted)] tabular-nums" style={{ left: `${100 - (h / 24) * 100}%`, transform: h === 24 ? 'none' : h === 0 ? 'translateX(-100%)' : 'translateX(-50%)' }}>
            {h === 0 ? 'NOW' : `−${h}H`}
          </span>
        ))}
      </div>
    </section>
  );
}
