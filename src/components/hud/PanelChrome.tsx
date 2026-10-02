'use client';
/**
 * Instrument chrome shared by every tool panel: 22 px grid, corner brackets, 2×16 gold accent bar,
 * 11 px/.22em title, gold hairline rule and an outlined state chip (STANDBY / PLOTTING / LIVE /
 * N RESULTS). Panels set their chip with usePanelChip(); a panel with no state of its own (Style
 * Studio, Settings, Region presets) shows no chip rather than a meaningless STANDBY. Panels put
 * their own header controls in the frame's title row with <PanelHeaderTools>, so a phone sheet has
 * one header row (round 4 visual m4). Owner: design-system-hud.
 */
import { Pin, PinOff, X } from 'lucide-react';
import { createContext, useContext, useEffect, useId, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type ChipTone = 'idle' | 'busy' | 'live' | 'warn' | 'error';

export interface PanelChipState {
  text: string;
  tone: ChipTone;
  /** Full wording for the tooltip when `text` is abbreviated (defaults to `text`). */
  title?: string;
}

const TONE_COLOR: Record<ChipTone, string> = {
  idle: 'var(--text-secondary)',
  busy: 'var(--cyan-primary)',
  live: 'var(--alert-green)',
  warn: 'var(--alert-orange)',
  error: 'var(--alert-red)',
};

const ChipContext = createContext<((c: PanelChipState) => void) | null>(null);
/** The frame's header slot for panel controls: undefined outside a frame, null until it mounts. */
const HeaderSlotContext = createContext<HTMLElement | null | undefined>(undefined);

/** Set this panel's header chip, e.g. usePanelChip('12 RESULTS', 'live'). Honest states only. */
export function usePanelChip(text: string, tone: ChipTone = 'idle', title?: string): void {
  const set = useContext(ChipContext);
  useEffect(() => {
    set?.({ text, tone, title });
  }, [set, text, tone, title]);
}

/**
 * A panel's own header controls (copy, import, reset…), rendered in the frame's title row next to
 * the close button. Outside an InstrumentFrame (a modal, a unit test) they render in place.
 */
export function PanelHeaderTools({ children }: { children: ReactNode }) {
  const slot = useContext(HeaderSlotContext);
  if (slot === undefined) return <div className="flex items-center justify-end gap-1">{children}</div>;
  return slot ? createPortal(children, slot) : null;
}

/** The chip gives way before the panel title does (long counts truncate, full text in `title`). */
export function StateChip({ text, tone, title }: PanelChipState) {
  return (
    <span className="instrument-chip min-w-0 overflow-hidden text-ellipsis" title={title ?? text} style={{ color: TONE_COLOR[tone] }}>
      {text}
    </span>
  );
}

interface FrameProps {
  title: string;
  onClose: () => void;
  onPin?: () => void;
  pinned?: boolean;
  children: ReactNode;
  className?: string;
  /** Rendered as an ARIA region (side panels) — modals supply their own dialog role. */
  as?: 'section' | 'div';
  headerExtra?: ReactNode;
  labelId?: string;
  /**
   * Phone sheets whose tab row already names the panel: the title stays for assistive tech
   * (sr-only, still the region's name) and the corner brackets are dropped.
   */
  sheet?: boolean;
  /** Phones: header buttons get 44 px touch targets. */
  touch?: boolean;
  /**
   * Phone sheet section tabs, rendered in the header row itself so the tabs, the panel's header
   * tools, the state chip and the close button share one row (r6 m: a landscape sheet is ~210 px
   * tall); the tab strip scrolls sideways in what is left. Implies `sheet`.
   */
  tabs?: ReactNode;
}

export function InstrumentFrame({ title, onClose, onPin, pinned, children, className = '', as = 'section', headerExtra, labelId, sheet: sheetProp = false, touch = false, tabs }: FrameProps) {
  const sheet = sheetProp || tabs != null;
  const [chip, setChip] = useState<PanelChipState | null>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const autoId = useId();
  const id = labelId ?? `${autoId}-title`;
  const Tag = as;
  const btn = `hud-control grid ${touch ? 'h-11 w-11' : 'h-7 w-7'} place-items-center text-[var(--text-secondary)] hover:text-[var(--gold-light)]`;
  return (
    <ChipContext.Provider value={setChip}>
      <HeaderSlotContext.Provider value={slot}>
        <Tag
          {...(as === 'section' ? { 'aria-labelledby': id } : {})}
          className={`instrument-grid ${sheet ? '' : 'instrument-corners'} relative flex min-h-0 flex-col ${className}`}
        >
          <header data-frame-header="" className={`relative flex items-center gap-2 ${tabs != null ? 'pl-0 pr-3' : 'px-4'} ${sheet ? 'pb-1 pt-1' : 'pb-2 pt-3'}`}>
            {!sheet && <span className="instrument-accent" aria-hidden />}
            <h2 id={id} className={sheet ? 'sr-only' : 'hud-title min-w-0 shrink-0 truncate'} title={title}>
              {title}
            </h2>
            {tabs != null ? <div className="min-w-0 flex-1">{tabs}</div> : <span className="min-w-0 flex-1" aria-hidden />}
            {headerExtra}
            <span ref={setSlot} data-panel-tools="" className="flex shrink-0 items-center gap-1 empty:hidden" />
            {chip && (
              <span className="flex min-w-0 max-w-[40%] shrink">
                <StateChip {...chip} />
              </span>
            )}
            {onPin && (
              <button type="button" onClick={onPin} aria-label={pinned ? `Unpin ${title}` : `Pin ${title}`} title={pinned ? 'Unpin' : 'Pin beside other panels'} className={btn}>
                {pinned ? <PinOff size={14} /> : <Pin size={14} />}
              </button>
            )}
            <button type="button" onClick={onClose} aria-label={`Close ${title}`} className={btn}>
              <X size={15} />
            </button>
          </header>
          <div className="instrument-rule mx-4" aria-hidden />
          <div className="hud-scroll relative min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
        </Tag>
      </HeaderSlotContext.Provider>
    </ChipContext.Provider>
  );
}
