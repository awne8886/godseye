'use client';
/**
 * Keyboard shortcuts overlay: renders KEY_BINDINGS verbatim (the same list the key handler reads),
 * so the overlay and the keys cannot disagree. Owner: design-system-hud.
 */
import { X } from 'lucide-react';
import { KEY_BINDINGS } from '@/lib/keyboard';
import type { PanelProps } from '@/lib/feature-module';
import ModalShell from '../ModalShell';

export function ShortcutTable() {
  return (
    <table className="w-full border-separate border-spacing-y-1" data-testid="shortcut-table">
      <thead className="sr-only">
        <tr>
          <th scope="col">Key</th>
          <th scope="col">Action</th>
        </tr>
      </thead>
      <tbody>
        {KEY_BINDINGS.map((b) => (
          <tr key={`${b.action}-${b.display}`} data-action={b.action}>
            <td className="w-[132px] pr-3 align-top">
              <kbd className="hud-text inline-block min-w-[28px] rounded-[var(--radius-chip)] border border-[var(--border-active)] bg-[rgba(var(--gold-rgb),0.06)] px-1.5 py-0.5 text-center text-[11px] text-[var(--gold-light)]">
                {b.display}
              </kbd>
            </td>
            <td className="font-sans text-[13px] text-[var(--text-primary)]">{b.description}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function HelpPanel({ onClose }: PanelProps) {
  return (
    <ModalShell
      title="Keyboard shortcuts"
      description="Every keyboard shortcut available on the map."
      onClose={onClose}
      className="left-1/2 top-1/2 max-h-[85vh] w-[min(520px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 gap-3 p-5 instrument-grid instrument-corners"
    >
      <button type="button" onClick={onClose} aria-label="Close shortcuts" className="hud-control absolute right-3 top-3 grid h-8 w-8 place-items-center text-[var(--text-secondary)] hover:text-[var(--gold-light)] phone:h-11 phone:w-11">
        <X size={15} />
      </button>
      <div className="instrument-rule" aria-hidden />
      <div className="hud-scroll relative min-h-0 overflow-y-auto">
        <ShortcutTable />
      </div>
      <p className="relative font-sans text-[12px] text-[var(--text-secondary)]">Shortcuts pause while you type in a text field. ⌘K, ⌘F and ESC work everywhere.</p>
    </ModalShell>
  );
}
