'use client';
/**
 * Top-right telemetry row: ZULU clock · STATUS (from /api/health, never assumed) · LAYERS ·
 * ENTITIES · version. Owner: design-system-hud.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { APP_VERSION } from '@/lib/config';
import { useLayerStatusStore } from '@/lib/layer-host';
import { useUiStore } from '@/lib/store';

function useZulu(): string {
  const [now, setNow] = useState<string>('--:--:--');
  useEffect(() => {
    const tick = () => setNow(new Date().toISOString().slice(11, 19));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export default function Telemetry() {
  const zulu = useZulu();
  const layers = useUiStore((s) => s.activeLayers.size);
  const entities = useLayerStatusStore((s) => Object.values(s.status).reduce((n, st) => n + (st?.count ?? 0), 0));
  const health = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const r = await fetch('/api/health');
      if (!r.ok) throw new Error(String(r.status));
      return (await r.json()) as { status: 'ok' | 'degraded' };
    },
    refetchInterval: 60_000,
  });
  const status = health.isError ? { t: 'OFFLINE', c: 'var(--alert-red)' } : !health.data ? { t: 'CONNECTING', c: 'var(--text-secondary)' } : health.data.status === 'ok' ? { t: 'LIVE', c: 'var(--alert-green)' } : { t: 'DEGRADED', c: 'var(--alert-orange)' };
  return (
    <div className="hud-micro absolute right-4 top-4 z-[var(--z-hud)] hidden items-center gap-3 text-[var(--text-secondary)] md:flex" aria-label="Telemetry">
      <span className="font-bold text-[var(--cyan-primary)]">ZULU {zulu}Z</span>
      <span aria-live="polite" style={{ color: status.c }}>STATUS: {status.t}</span>
      <span className="text-[var(--cyan-primary)]">{layers} LAYERS</span>
      <span className="text-[var(--alert-green)]">{entities.toLocaleString('en-US')} ENTITIES</span>
      <span>V{APP_VERSION}</span>
    </div>
  );
}
