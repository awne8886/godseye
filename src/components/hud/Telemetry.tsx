'use client';
/**
 * Top-right telemetry row: ZULU clock · STATUS (LIVE only when ≥ 1 active layer is actually live) ·
 * LAYERS (capability-hidden layers excluded) · ENTITIES · SOLAR (GOES X-ray class) + Kp from
 * /api/space-weather ("—" when that feed is unavailable, never a guess) · version.
 * Owner: design-system-hud.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { APP_VERSION } from '@/lib/config';
import { useLayerStatusStore } from '@/lib/layer-host';
import { useDrawPending } from '@/lib/map/admission-scheduler';
import { useUiStore } from '@/lib/store';
import type { SpaceWeatherResponse } from '@/lib/types';
import { useHealth, useVisibleLayers } from './hooks';
import { STATUS_COLOR, activeVisible, entitiesLabel, hudStatus } from './status-logic';

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

export function useSpaceWeather() {
  return useQuery({
    queryKey: ['space-weather', 'telemetry'],
    queryFn: async ({ signal }) => {
      const r = await fetch('/api/space-weather', { signal });
      if (!r.ok) throw new Error(`space-weather HTTP ${r.status}`);
      return (await r.json()) as SpaceWeatherResponse;
    },
    refetchInterval: 5 * 60_000,
    retry: false,
  });
}

export default function Telemetry() {
  const zulu = useZulu();
  const active = useUiStore((s) => s.activeLayers);
  const status = useLayerStatusStore((s) => s.status);
  const health = useHealth();
  const visible = useVisibleLayers();
  const visibleIds = useMemo(() => new Set(visible.map((l) => l.id)), [visible]);
  const shown = activeVisible(active, visibleIds);
  const entities = shown.reduce((n, id) => n + (status[id as keyof typeof status]?.count ?? 0), 0);
  // Never claim entities the map has not drawn yet (layers waiting for their admission slot): the
  // count stays visible but is worded as received while drawing is in progress (R3-m6).
  const drawPending = useDrawPending();
  const st = hudStatus({ active, visible: visibleIds, status, health: health.isError ? 'error' : health.data ? 'ok' : 'loading' });
  const sw = useSpaceWeather();
  const kp = sw.data?.kp.kp;
  const xray = sw.data?.xray.class;
  const kpColor = typeof kp === 'number' ? (kp >= 5 ? 'var(--alert-red)' : kp >= 4 ? 'var(--alert-orange)' : 'var(--alert-green)') : 'var(--text-secondary)';

  return (
    <div className="hud-micro fixed right-4 top-4 z-[var(--z-hud)] flex items-center gap-3 text-[var(--text-secondary)]" aria-label="Telemetry" role="group" data-map-inset="telemetry">
      <span className="inline font-bold text-[var(--cyan-primary)] phone:hidden">ZULU {zulu}Z</span>
      <span aria-live="polite" className="flex items-center gap-1.5" style={{ color: STATUS_COLOR[st] }}>
        <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLOR[st], boxShadow: st === 'LIVE' ? '0 0 6px var(--alert-green)' : undefined }} />
        STATUS: {st}
      </span>
      <span className="inline text-[var(--cyan-primary)] phone:hidden">{shown.length} LAYERS</span>
      <span
        data-testid="telemetry-entities"
        className="inline text-[var(--alert-green)] phone:hidden"
        title={drawPending && entities > 0 ? 'Entities received from the feeds; some layers are still being drawn' : undefined}
      >
        {entitiesLabel(entities, drawPending)}
      </span>
      <span className="hidden lg:inline phone:hidden" title={sw.data?.xray.observedAt ? `GOES X-ray observed ${sw.data.xray.observedAt}` : 'Space weather feed unavailable'}>
        SOLAR <span className="text-[var(--text-primary)]">{xray ?? '—'}</span>
      </span>
      <span className="hidden lg:inline phone:hidden" title={sw.data?.kp.observedAt ? `Kp observed ${sw.data.kp.observedAt}` : 'Space weather feed unavailable'}>
        KP <span style={{ color: kpColor }}>{typeof kp === 'number' ? kp.toFixed(1) : '—'}</span>
      </span>
      <span className="inline phone:hidden">V{APP_VERSION}</span>
    </div>
  );
}
