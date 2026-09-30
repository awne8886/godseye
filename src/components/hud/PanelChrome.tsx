'use client';
/**
 * Instrument chrome shared by every tool panel: 22 px grid, corner brackets, 2×16 gold accent bar,
 * 11 px/.22em title, gold hairline rule and an outlined state chip (STANDBY / PLOTTING / LIVE /
 * N RESULTS). Panels set their chip with usePanelChip(). Owner: design-system-hud.
 */
import { Pin, PinOff, X } from 'lucide-react';
import { createContext, useContext, useEffect, useId, useState, type ReactNode } from 'react';

export type ChipTone = 'idle' | 'busy' | 'live' | 'warn' | 'error';

export interface PanelChipState {
  text: string;
  tone: ChipTone;
}

const TONE_COLOR: Record<ChipTone, string> = {
  idle: 'var(--text-secondary)',
  busy: 'var(--cyan-primary)',
  live: 'var(--alert-green)',
  warn: 'var(--alert-orange)',
  error: 'var(--alert-red)',
};

const ChipContext = createContext<((c: PanelChipState) => void) | null>(null);

/** Set this panel's header chip, e.g. usePanelChip('12 RESULTS', 'live'). Honest states only. */
export function usePanelChip(text: string, tone: ChipTone = 'idle'): void {
  const set = useContext(ChipContext);
  useEffect(() => {
    set?.({ text, tone });
  }, [set, text, tone]);
}

/** The chip gives way before the panel title does (long counts truncate, full text in `title`). */
export function StateChip({ text, tone }: PanelChipState) {
  return (
    <span className="instrument-chip min-w-0 overflow-hidden text-ellipsis" title={text} style={{ color: TONE_COLOR[tone] }}>
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
}

export function InstrumentFrame({ title, onClose, onPin, pinned, children, className = '', as = 'section', headerExtra, labelId, sheet = false }: FrameProps) {
  const [chip, setChip] = useState<PanelChipState>({ text: 'STANDBY', tone: 'idle' });
  const autoId = useId();
  const id = labelId ?? `${autoId}-title`;
  const Tag = as;
  return (
    <ChipContext.Provider value={setChip}>
      <Tag
        {...(as === 'section' ? { 'aria-labelledby': id } : {})}
        className={`instrument-grid ${sheet ? '' : 'instrument-corners'} relative flex min-h-0 flex-col ${className}`}
      >
        <header className={`relative flex items-center gap-2 px-4 ${sheet ? 'pb-1 pt-1' : 'pb-2 pt-3'}`}>
          {!sheet && <span className="instrument-accent" aria-hidden />}
          <h2 id={id} className={sheet ? 'sr-only' : 'hud-title min-w-0 shrink-0 truncate'} title={title}>
            {title}
          </h2>
          <span className="min-w-0 flex-1" aria-hidden />
          {headerExtra}
          <StateChip {...chip} />
          {onPin && (
            <button
              type="button"
              onClick={onPin}
              aria-label={pinned ? `Unpin ${title}` : `Pin ${title}`}
              title={pinned ? 'Unpin' : 'Pin beside other panels'}
              className="hud-control grid h-7 w-7 place-items-center text-[var(--text-secondary)] hover:text-[var(--gold-light)]"
            >
              {pinned ? <PinOff size={14} /> : <Pin size={14} />}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${title}`}
            className="hud-control grid h-7 w-7 place-items-center text-[var(--text-secondary)] hover:text-[var(--gold-light)]"
          >
            <X size={15} />
          </button>
        </header>
        <div className="instrument-rule mx-4" aria-hidden />
        <div className="hud-scroll relative min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
      </Tag>
    </ChipContext.Provider>
  );
}
