'use client';
/**
 * Flight Watch (`panels['flight-watch']`): up to six watched aircraft with live telemetry from the
 * flights feed, identity and current-leg track from /api/aircraft (the map draws their trails),
 * and the route. Also hosts the aircraft colour mode (class or altitude ramp).
 */
import { useEffect, useState } from 'react';
import { Crosshair, Plane, X } from 'lucide-react';
import type { PanelProps } from '@/lib/feature-module';
import { OBSERVATION_CADENCE_MS } from '@/lib/layer-registry';
import { MAX_WATCHED_FLIGHTS, useUiStore } from '@/lib/store';
import { entityFreshness } from '@/lib/freshness';
import type { FreshnessState } from '@/lib/types';
import type { FlightRecord } from '../adsb';
import { deadReckon } from '../codec';
import { FreshnessBadge, useAircraftDetail, useFlightRoute } from './AircraftCard';
import { BUCKET_LAYER, useAviationPrefs, useFlights } from './useFlights';
import { formatAlt, formatKt } from './format';

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

const mono10 = 'font-mono text-[10px] uppercase tracking-[0.16em]';
const mono11 = 'font-mono text-[11px] uppercase tabular-nums tracking-[0.08em]';

/** `feed`: whether the flights feed answered (`live`), answered SOURCE OFFLINE, or has not answered yet. */
function WatchRow({ hex, live, feed, feedState, now }: { hex: string; live: FlightRecord | null; feed: 'live' | 'offline' | 'pending'; feedState: FreshnessState; now: number }) {
  const detail = useAircraftDetail(/^[0-9a-f]{6}$/.test(hex) ? hex : null);
  const route = useFlightRoute(live?.callsign ?? null, live && !live.onGround ? { lat: live.lat, lng: live.lng, gsKt: live.gsKt } : null);
  const unwatch = useUiStore((s) => s.unwatchFlight);
  const flyTo = useUiStore((s) => s.requestFlyTo);
  const id = detail.data?.identity ?? null;
  const track = detail.data?.track ?? [];
  const last = track.at(-1);
  const at = live ? live.seenAt * 1000 : last ? Date.parse(last.t) : null;
  const state = at === null ? 'offline' : entityFreshness({ kind: 'live', at, observationCadenceMs: OBSERVATION_CADENCE_MS[live ? BUCKET_LAYER[live.bucket] : 'flights'], feedState, now });
  const pos = live ? deadReckon(live, now) : last ? { lat: last.lat, lng: last.lng } : null;
  const title = live?.callsign ?? id?.registration ?? hex.toUpperCase();

  return (
    <li className="flex flex-col gap-1 border-t border-[var(--text-muted)]/20 py-2 first:border-t-0">
      <div className="flex items-center gap-2">
        <Plane aria-hidden className="size-4 shrink-0 text-[var(--gold-primary)]" />
        <span className={`${mono11} truncate text-[var(--text-heading)]`}>{title}</span>
        <span className={`${mono10} text-[var(--text-muted)]`}>{hex.toUpperCase()}</span>
        <span className="ml-auto" />
        <FreshnessBadge state={state} at={at} now={now} />
        <button type="button" aria-label={`Centre map on ${title}`} disabled={!pos} onClick={() => pos && flyTo({ lng: pos.lng, lat: pos.lat, zoom: 8 })} className="grid size-11 place-items-center rounded text-[var(--text-secondary)] hover:text-[var(--gold-primary)] focus-visible:outline-2 focus-visible:outline-[var(--gold-primary)] md:size-7">
          <Crosshair aria-hidden className="size-4" />
        </button>
        <button type="button" aria-label={`Stop watching ${title}`} onClick={() => unwatch(hex)} className="grid size-11 place-items-center rounded text-[var(--text-secondary)] hover:text-[var(--alert-red)] focus-visible:outline-2 focus-visible:outline-[var(--gold-primary)] md:size-7">
          <X aria-hidden className="size-4" />
        </button>
      </div>
      <p className="truncate text-[12px] text-[var(--text-secondary)]">
        {id ? [id.model, id.registration, id.typeCode, id.operator].filter(Boolean).join(' · ') : detail.isLoading ? 'Identifying airframe…' : 'Airframe not in registry'}
      </p>
      {live && (
        <p className={`${mono11} text-[var(--text-primary)]`}>
          {formatAlt(live)} · {formatKt(live.gsKt)} · SQK {live.squawk ?? '—'}
          {live.emergency ? <span className="text-[var(--alert-red)]"> · EMERGENCY {live.emergency}</span> : null}
        </p>
      )}
      <p className={`${mono10} text-[var(--text-secondary)]`}>
        {route.data?.found && route.data.origin && route.data.destination
          ? `${route.data.origin.iata ?? route.data.origin.icao} → ${route.data.destination.iata ?? route.data.destination.icao}${route.data.progress !== null ? ` · ${Math.round(route.data.progress * 100)}%` : ''}${route.data.stale ? ' · STALE ROUTE RECORD' : ''}`
          : live?.callsign
            ? route.isLoading
              ? 'RESOLVING ROUTE…'
              : 'NO SCHEDULED ROUTE'
            : 'NO CALLSIGN'}
      </p>
      <p className={`${mono10} text-[var(--text-muted)]`}>
        {track.length} POINTS THIS LEG
        {!live && feed === 'live' && <span className="text-[var(--alert-orange)]"> · NO LONGER IN THE LIVE FEED</span>}
        {feed === 'offline' && <span className="text-[var(--alert-red)]"> · FEED OFFLINE</span>}
      </p>
    </li>
  );
}

export default function FlightWatchPanel({ onClose }: PanelProps) {
  const watched = useUiStore((s) => s.watchedFlights);
  const { data } = useFlights(watched.length > 0);
  const colorMode = useAviationPrefs((s) => s.colorMode);
  const setColorMode = useAviationPrefs((s) => s.setColorMode);
  const now = useNow();
  const feedState: FreshnessState = data?.meta.state ?? 'recent';
  const chip = data?.offline ? 'SOURCE OFFLINE' : watched.length ? `${watched.length} WATCHED` : 'STANDBY';

  return (
    <section aria-label="Flight Watch" data-testid="flight-watch" className="glass-panel relative flex w-full flex-col gap-3 p-4 md:w-[360px]">
      <span aria-hidden className="absolute inset-y-4 left-0 w-0.5 rounded bg-[var(--gold-primary)]" />
      <header className="flex items-center gap-2">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--text-heading)]">FLIGHT WATCH</h2>
        <span className={`${mono10} rounded-full border border-[var(--gold-primary)]/50 px-2 py-0.5 text-[var(--gold-primary)]`} aria-live="polite">
          {chip}
        </span>
        <button type="button" aria-label="Close Flight Watch" onClick={onClose} className="ml-auto grid size-11 place-items-center rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--gold-primary)] md:size-7">
          <X aria-hidden className="size-4" />
        </button>
      </header>

      <div role="group" aria-label="Aircraft colour" className="flex items-center gap-1">
        <span className={`${mono10} mr-1 text-[var(--text-muted)]`}>COLOUR</span>
        {(['bucket', 'altitude'] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={colorMode === m}
            onClick={() => setColorMode(m)}
            className={`${mono10} min-h-11 rounded border px-2 md:min-h-7 ${colorMode === m ? 'border-[var(--gold-primary)] text-[var(--gold-primary)]' : 'border-[var(--text-muted)]/40 text-[var(--text-secondary)]'} focus-visible:outline-2 focus-visible:outline-[var(--gold-primary)]`}
          >
            {m === 'bucket' ? 'CLASS' : 'ALTITUDE'}
          </button>
        ))}
      </div>

      {watched.length === 0 ? (
        <p className="text-[12px] text-[var(--text-secondary)]">Open an aircraft and press WATCH to follow it here with its flown track (up to {MAX_WATCHED_FLIGHTS}).</p>
      ) : (
        <ul className="flex flex-col">
          {watched.map((hex) => (
            <WatchRow key={hex} hex={hex} live={data?.byId.get(hex) ?? null} feed={!data ? 'pending' : data.offline ? 'offline' : 'live'} feedState={feedState} now={now} />
          ))}
        </ul>
      )}
      <p className="text-[12px] text-[var(--text-muted)]">Aircraft data © adsb.lol contributors, ODbL 1.0</p>
    </section>
  );
}
