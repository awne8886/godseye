'use client';
/**
 * Command palette (⌘K / Ctrl-K / /): cmdk list of tools, panels, layers, region presets and map
 * actions inside a modal dialog. Owner: design-system-hud.
 */
import { Command, defaultFilter } from 'cmdk';
import { Search } from 'lucide-react';
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { PanelProps } from '@/lib/feature-module';
import { useUiStore } from '@/lib/store';
import { isPanelAvailable, useHasBluetooth, useVisibleLayers } from '../hooks';
import ModalShell from '../ModalShell';
import { paletteItems, queryItems, rankItem, topItem, type PaletteItem } from '../palette-items';

const GROUPS: PaletteItem['group'][] = ['TOOLS', 'PANELS', 'ACTIONS', 'REGIONS', 'LAYERS'];

export default function PalettePanel({ onClose }: PanelProps) {
  const bt = useHasBluetooth();
  const layers = useVisibleLayers();
  const active = useUiStore((s) => s.activeLayers);
  const [query, setQuery] = useState('');
  // The latest typed text and whether the visitor moved the selection since (arrows / pointer).
  const typed = useRef('');
  const navigated = useRef(false);
  const build = (q: string) => {
    const available = (id: Parameters<typeof isPanelAvailable>[0]) => isPanelAvailable(id, bt);
    const all = [...queryItems(q, available), ...paletteItems({ available, layers, active })];
    // Display order (groups as rendered) so ties resolve to the item shown first.
    return GROUPS.flatMap((g) => all.filter((i) => i.group === g));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const items = useMemo(() => build(query), [bt, layers, active, query]);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const filter = (value: string, search: string, keywords?: string[]) => {
    const item = byId.get(value);
    const fuzzy = defaultFilter(item ? `${item.label} ${item.id}` : value, search, keywords);
    return item ? rankItem(item, search, fuzzy) : fuzzy;
  };

  const run = (item: PaletteItem) => {
    item.run();
    if (useUiStore.getState().openPanel === 'palette') onClose();
  };

  /** Enter runs the best match of what is typed right now unless the visitor picked another item (n1). */
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key) || (e.ctrlKey && /^[jknp]$/.test(e.key))) {
      navigated.current = true;
      return;
    }
    if (e.key !== 'Enter' || e.nativeEvent.isComposing || navigated.current || !typed.current.trim()) return;
    const best = topItem(build(typed.current), typed.current, (v, s, k) => defaultFilter(v, s, k));
    if (!best) return;
    e.preventDefault();
    run(best);
  };

  return (
    <ModalShell
      title="Command palette"
      description="Type to search tools, panels, layers, regions and actions."
      onClose={onClose}
      hideTitle
      className="left-1/2 top-[14vh] w-[min(640px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden"
    >
      <Command label="Command palette" loop filter={filter} onKeyDown={onKeyDown} className="flex max-h-[62vh] flex-col">
        <div className="flex items-center gap-2 border-b border-[var(--border-primary)] px-4">
          <Search size={15} aria-hidden className="text-[var(--gold-primary)]" />
          <Command.Input
            autoFocus
            value={query}
            onValueChange={(v) => {
              typed.current = v;
              navigated.current = false;
              setQuery(v);
            }}
            placeholder="Tools, layers, regions — or LHR JFK, London to New York, G-XWBA"
            className="hud-text h-12 flex-1 bg-transparent text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
          />
          <kbd className="hud-micro rounded-[var(--radius-chip)] border border-[var(--border-primary)] px-1.5 text-[var(--text-secondary)]">ESC</kbd>
        </div>
        <Command.List className="hud-scroll min-h-0 flex-1 overflow-y-auto p-2" onPointerMove={() => (navigated.current = true)}>
          <Command.Empty className="hud-micro px-3 py-6 text-center text-[var(--text-secondary)]">NO MATCHES</Command.Empty>
          {GROUPS.map((g) => {
            const list = items.filter((i) => i.group === g);
            if (!list.length) return null;
            return (
              <Command.Group key={g} heading={g} className="[&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.16em] [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[var(--text-muted)]">
                {list.map((i) => (
                  <Command.Item
                    key={i.id}
                    value={i.id}
                    keywords={i.keywords}
                    onSelect={() => run(i)}
                    className="hud-control flex min-h-[36px] cursor-pointer items-center phone:min-h-[44px] gap-3 px-2 py-1.5 data-[selected=true]:bg-[rgba(var(--gold-rgb),0.12)] data-[selected=true]:text-[var(--gold-light)]"
                  >
                    <span className="hud-text flex-1 truncate text-[12px]">{i.label}</span>
                    {i.hint && <span className="max-w-[45%] truncate font-sans text-[12px] text-[var(--text-secondary)]">{i.hint}</span>}
                  </Command.Item>
                ))}
              </Command.Group>
            );
          })}
        </Command.List>
      </Command>
    </ModalShell>
  );
}
