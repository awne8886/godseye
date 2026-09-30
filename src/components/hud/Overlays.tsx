'use client';
/**
 * Screen overlays under MapLibre's bottom controls (z 2–4): vignette, 2% scanlines, Style Studio
 * FX (scanlines/grain/vignette driven by CSS variables), four 64 px gold hairline corner brackets,
 * and the sensor mode overlay (CRT/NVG/FLIR/Noir; the map canvas filter lives in base.css).
 * At most one ambient animation (the CRT sweep). Owner: design-system-hud.
 */
import { useUiStore } from '@/lib/store';

export default function Overlays() {
  const sensor = useUiStore((s) => s.sensor);
  const corner = 'pointer-events-none absolute h-16 w-16 border-[rgba(var(--gold-rgb),0.3)]';
  return (
    <>
      <div aria-hidden className="pointer-events-none fixed inset-0 z-[var(--z-overlay)]">
        <div className="vignette absolute inset-0" />
        <div className="crt-scanlines absolute inset-0" />
        <div className="fx-scanlines absolute inset-0" />
        <div className="fx-grain absolute inset-0" />
        <div className="fx-vignette absolute inset-0" />
        <div className={`${corner} left-2 top-2 border-l border-t`} />
        <div className={`${corner} right-2 top-2 border-r border-t`} />
        <div className={`${corner} bottom-9 left-2 border-b border-l`} />
        <div className={`${corner} bottom-9 right-2 border-b border-r`} />
      </div>
      {sensor !== 'none' && (
        <div aria-hidden className={`pointer-events-none fixed inset-0 z-[var(--z-sensor)] overflow-hidden sensor-${sensor}`}>
          {sensor === 'crt' && <div className="sensor-crt-sweep absolute inset-x-0 top-0" />}
        </div>
      )}
      {sensor !== 'none' && (
        <p className="hud-micro fixed left-1/2 top-4 z-[var(--z-hud)] -translate-x-1/2 rounded-[var(--radius-chip)] border border-[var(--border-active)] bg-[var(--glass-3)] px-2 py-1 text-[var(--gold-light)]" role="status">
          SENSOR · {sensor.toUpperCase()} · PRESS 0 TO CLEAR
        </p>
      )}
    </>
  );
}
