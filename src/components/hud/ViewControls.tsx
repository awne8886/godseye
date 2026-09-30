'use client';
/** Bottom-left 3D | 2D segmented control (design-system-hud adds MAP | SAT and the scale bar). Owner: design-system-hud. */
import { Globe, MapPinned } from 'lucide-react';
import { useUiStore } from '@/lib/store';

export default function ViewControls() {
  const projection = useUiStore((s) => s.projection);
  const setProjection = useUiStore((s) => s.setProjection);
  const seg = (p: 'globe' | 'mercator', label: string, title: string, Icon: typeof Globe) => (
    <button
      type="button"
      aria-pressed={projection === p}
      title={title}
      onClick={() => setProjection(p)}
      className={`hud-micro flex items-center gap-1.5 rounded-md px-2.5 py-1.5 ${projection === p ? 'border border-[var(--border-active)] bg-[rgba(212,175,55,0.1)] text-[var(--gold-light)]' : 'border border-transparent text-[var(--text-secondary)]'}`}
    >
      <Icon size={13} /> {label}
    </button>
  );
  return (
    <div className="glass-panel absolute bottom-[100px] left-3 z-[var(--z-hud)] flex gap-1 p-1 md:left-[120px]" role="group" aria-label="Projection">
      {seg('globe', '3D', '3D Globe', Globe)}
      {seg('mercator', '2D', '2D Map', MapPinned)}
    </div>
  );
}
