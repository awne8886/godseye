'use client';
/**
 * Left layer rail (desktop): one button per registry group with a cyan count badge. Hover shows the
 * group's flyout; click pins it. Flyouts are disclosures (aria-expanded + aria-controls), not
 * dialogs. The rail bottom holds the rail-bottom launchers (Settings, Style Studio) and Ghost
 * Protocol. Owner: design-system-hud.
 *
 * Stacking (r6 M): the rail itself is not a stacking context (absolute, no z-index, glass on a
 * background child), so a flyout can sit at --z-docked above the view strip (--z-hud) and the status
 * bar (--z-status) while staying next to its button in the DOM and tab order. Each flyout is clamped
 * between the first rail button and the status bar and scrolls inside that height.
 *
 * One flyout (r10 m): a single AnimatePresence, keyed by the shown group, lives in the group that
 * was shown last. Switching groups unmounts the previous flyout at once instead of leaving it
 * mid-exit next to a stalled entry; closing still animates out. Opacity/transform only (no filter
 * keyframe, which runs on the main thread); reduced motion comes from HudMotion's MotionConfig.
 */
import { AnimatePresence, m } from 'motion/react';
import { Ghost, Settings2, SlidersHorizontal } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LAYER_GROUPS, type LayerGroupId, type LayerId } from '@/lib/layer-registry';
import { useUiStore } from '@/lib/store';
import { useVisibleLayers } from './hooks';
import { useHudStore } from './hud-store';
import { iconFor } from './icons';
import { LayerList } from './LayerRows';

/** Top of the first rail button (the rail's pt-24): flyouts never rise over the wordmark. */
export const FLYOUT_TOP_PX = 96;
/** Gap kept between a flyout and the status bar. */
export const FLYOUT_GAP_PX = 8;

export interface FlyoutPlacement {
  /** Offset from the group button's top (negative = moved up so the list fits). */
  offset: number;
  /** Height the flyout may use before its list scrolls. */
  maxHeight: number;
}

/**
 * Where a flyout goes: level with its button, moved up just enough for its content to fit above
 * `bottom` (the status bar top minus a gap), never above `top`; when even that is too short the
 * flyout fills top..bottom and its list scrolls.
 */
export function flyoutPlacement(anchorTop: number, contentHeight: number, top: number, bottom: number): FlyoutPlacement {
  const avail = Math.max(0, bottom - top);
  const h = Math.min(contentHeight, avail);
  const y = Math.max(top, Math.min(anchorTop, bottom - h));
  return { offset: y - anchorTop, maxHeight: Math.max(0, bottom - y) };
}

function measureBottom(): number {
  const bar = document.querySelector('[data-map-inset="status-bar"]');
  const barTop = bar?.getBoundingClientRect().top;
  return (barTop && barTop > 0 ? barTop : window.innerHeight) - FLYOUT_GAP_PX;
}

export default function LayerRail() {
  const [hover, setHover] = useState<LayerGroupId | null>(null);
  const pinned = useHudStore((s) => s.pinnedFlyout);
  const setPinned = useHudStore((s) => s.setPinnedFlyout);
  const active = useUiStore((s) => s.activeLayers);
  const setLayer = useUiStore((s) => s.setLayer);
  const openPanel = useUiStore((s) => s.openPanel);
  const togglePanel = useUiStore((s) => s.togglePanel);
  const ghost = useUiStore((s) => s.ghost);
  const setGhost = useUiStore((s) => s.setGhost);
  const layers = useVisibleLayers();
  const groups = LAYER_GROUPS.filter((g) => layers.some((l) => l.group === g.id));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const railRef = useRef<HTMLElement>(null);
  const shown = pinned ?? hover;
  // The group whose cell hosts the flyout presence: the shown one, or the last one while it exits.
  const [host, setHost] = useState<LayerGroupId | null>(shown);
  if (shown && shown !== host) setHost(shown);
  // Callback ref: the placement effect re-runs for whichever flyout element is mounted.
  const [flyoutEl, setFlyoutEl] = useState<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<FlyoutPlacement | null>(null);

  // Clamp the open flyout between the first rail button and the status bar (re-run on resize and
  // when its rows change height, e.g. a layer's status line appears).
  useLayoutEffect(() => {
    const el = flyoutEl;
    if (!shown || !el) return;
    const place = () => {
      const anchor = el.parentElement?.getBoundingClientRect().top ?? FLYOUT_TOP_PX;
      const list = el.querySelector<HTMLElement>('[data-flyout-list]');
      const chrome = el.offsetHeight - (list?.clientHeight ?? 0);
      const content = chrome + (list?.scrollHeight ?? 0);
      const next = flyoutPlacement(anchor, content, FLYOUT_TOP_PX, measureBottom());
      setPlacement((p) => (p && p.offset === next.offset && p.maxHeight === next.maxHeight ? p : next));
    };
    place();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    const list = el.querySelector('[data-flyout-list]');
    if (ro && list?.firstElementChild) ro.observe(list.firstElementChild);
    window.addEventListener('resize', place);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [shown, flyoutEl]);

  // A pinned flyout closes on a click anywhere outside the rail (and on ESC via the key handler).
  useEffect(() => {
    if (!pinned) return;
    const onDown = (e: PointerEvent) => {
      if (railRef.current && !railRef.current.contains(e.target as Node)) setPinned(null);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [pinned, setPinned]);

  const enter = (g: LayerGroupId) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setHover(g), 120);
  };
  const leave = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setHover(null), 220);
  };

  return (
    <nav ref={railRef} data-map-inset="rail" aria-label="Map layers" className="absolute bottom-7 left-0 top-0 flex w-12 flex-col items-center gap-1 pb-3 pt-24 phone:hidden">
      <div aria-hidden data-rail-bg="" className="glass-rail pointer-events-none absolute inset-0 z-[var(--z-rail)]" />
      {groups.map((g) => {
        const Icon = iconFor(g.icon);
        const inGroup = layers.filter((l) => l.group === g.id);
        const on = inGroup.filter((l) => active.has(l.id as LayerId) && !l.parent).length;
        const expanded = shown === g.id;
        const panelId = `flyout-${g.id}`;
        return (
          <div key={g.id} className="relative" onMouseEnter={() => enter(g.id)} onMouseLeave={leave}>
            <button
              type="button"
              aria-label={g.label}
              aria-expanded={expanded}
              aria-controls={panelId}
              title={g.label}
              onClick={() => setPinned(pinned === g.id ? null : g.id)}
              className={`hud-control relative z-[var(--z-rail)] grid h-10 w-10 place-items-center ${on ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'} ${pinned === g.id ? 'bg-[rgba(var(--gold-rgb),0.12)] text-[var(--gold-light)]' : ''} hover:text-[var(--gold-light)]`}
            >
              <Icon size={16} aria-hidden />
              {on > 0 && (
                <span className="absolute right-0 top-0 min-w-[14px] rounded-full bg-[var(--cyan-primary)] px-0.5 text-center font-mono text-[10px] leading-[14px] text-[var(--bg-void)]">
                  {on}
                </span>
              )}
            </button>
            {host === g.id && (
              <AnimatePresence>
                {expanded && (
                  <m.div
                    ref={setFlyoutEl}
                    id={panelId}
                    key={panelId}
                    data-flyout=""
                    style={{ top: placement?.offset ?? 0, maxHeight: placement?.maxHeight ?? `calc(100dvh - ${FLYOUT_TOP_PX}px - 36px)` }}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -8 }}
                    transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                    className="glass-panel instrument-corners absolute left-[52px] z-[var(--z-docked)] flex w-[320px] flex-col p-3"
                    role="region"
                    aria-label={`${g.label} layers`}
                  >
                    <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
                      <span className="hud-title">{g.label}</span>
                      <button
                        type="button"
                        className="hud-micro hud-control min-h-[24px] px-2 text-[var(--gold-primary)] hover:bg-[rgba(var(--gold-rgb),0.08)]"
                        onClick={() => inGroup.forEach((l) => setLayer(l.id as LayerId, on === 0))}
                      >
                        {on === 0 ? 'ALL' : 'NONE'}
                      </button>
                    </div>
                    <div data-flyout-list="" className="hud-scroll -mr-2 min-h-0 overflow-y-auto overscroll-contain pr-2">
                      <div>
                        <LayerList layers={inGroup} />
                      </div>
                    </div>
                  </m.div>
                )}
              </AnimatePresence>
            )}
          </div>
        );
      })}
      <div className="relative z-[var(--z-rail)] mt-auto flex flex-col items-center gap-1">
        <span aria-hidden className="mb-1 h-px w-6 bg-[var(--border-primary)]" />
        <button
          type="button"
          aria-label="Ghost Protocol"
          aria-pressed={ghost}
          title="Ghost Protocol — violet low-signature palette"
          onClick={() => setGhost(!ghost)}
          className="hud-control grid h-10 w-10 place-items-center"
          style={{ color: ghost ? 'var(--gold-primary)' : 'var(--text-secondary)' }}
        >
          <Ghost size={16} aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Style Studio"
          aria-pressed={openPanel === 'style-studio'}
          title="Style Studio — live UI tokens"
          onClick={() => togglePanel('style-studio')}
          className="hud-control grid h-10 w-10 place-items-center"
          style={{ color: openPanel === 'style-studio' ? 'var(--gold-primary)' : 'var(--text-secondary)' }}
        >
          <SlidersHorizontal size={16} aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Settings"
          aria-pressed={openPanel === 'settings'}
          title="Settings — units, motion, privacy"
          onClick={() => togglePanel('settings')}
          className="hud-control grid h-10 w-10 place-items-center"
          style={{ color: openPanel === 'settings' ? 'var(--gold-primary)' : 'var(--text-secondary)' }}
        >
          <Settings2 size={16} aria-hidden />
        </button>
      </div>
    </nav>
  );
}
