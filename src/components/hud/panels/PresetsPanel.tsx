'use client';
/**
 * Region presets (OSIRIS's 12 camera targets) plus consent-based "centre on my region".
 * Owner: design-system-hud.
 */
import { LocateFixed } from 'lucide-react';
import type { PanelProps } from '@/lib/feature-module';
import { REGION_PRESETS } from '@/lib/presets';
import { useUiStore } from '@/lib/store';
import { locateOnce } from '../Boot';
import { iconFor } from '../icons';

export default function PresetsPanel(_: PanelProps) {
  const requestFlyTo = useUiStore((s) => s.requestFlyTo);
  const updateSettings = useUiStore((s) => s.updateSettings);
  return (
    <div className="space-y-3">
      <ul className="grid grid-cols-2 gap-1.5">
        {REGION_PRESETS.map((r) => {
          const Icon = iconFor(r.icon);
          return (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => requestFlyTo({ lat: r.lat, lng: r.lng, zoom: r.zoom })}
                className="hud-micro hud-control flex min-h-[40px] w-full items-center gap-2 border border-[var(--border-secondary)] px-2.5 text-left text-[var(--text-primary)] hover:border-[var(--border-active)] hover:text-[var(--gold-light)]"
              >
                <Icon size={14} aria-hidden className="text-[var(--gold-primary)]" />
                {r.label}
              </button>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={() => {
          updateSettings({ geoConsent: 'granted' });
          void locateOnce(6);
        }}
        className="hud-micro hud-control flex min-h-[40px] w-full items-center justify-center gap-2 border border-[var(--border-cyan)] text-[var(--cyan-primary)]"
      >
        <LocateFixed size={14} aria-hidden /> CENTRE ON MY REGION
      </button>
      <p className="font-sans text-[12px] text-[var(--text-secondary)]">Your browser asks before sharing your location; it is used only to move the camera and is never sent to the server.</p>
    </div>
  );
}
