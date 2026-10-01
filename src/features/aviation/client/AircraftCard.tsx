'use client';
/**
 * Aircraft entity card body (`cards.aircraft`; the HUD supplies the frame). Shows the source, the
 * observed-at time and an honest freshness badge (entityFreshness with the 60 s observation
 * cadence), live telemetry from the flights feed, adsb.lol/adsbdb identity, the route, and a
 * Watch toggle for Flight Watch. Upstream strings render as text only.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Eye, EyeOff, Plane, Route, TriangleAlert } from 'lucide-react';
import type { CardProps } from '@/lib/feature-module';
import { OBSERVATION_CADENCE_MS, type LayerId } from '@/lib/layer-registry';
import { useLayerStatus } from '@/lib/layer-host';
import { MAX_WATCHED_FLIGHTS, useUiStore } from '@/lib/store';
import { FRESHNESS_COLOR_TOKEN, entityFreshness, formatAge, freshnessLabel } from '@/lib/freshness';
import type { FreshnessState } from '@/lib/types';
import type { FlightRecord } from '../adsb';
import { airlineCodeOf } from '../classify';
import { deadReckon } from '../codec';
import type { AircraftDetail } from '../server/aircraft';
import type { FlightRoute } from '../server/route-lookup';
import { BUCKET_LAYER, useFlights } from './useFlights';
import { BUCKET_LABEL, EMERGENCY_LABEL, POS_SOURCE_LABEL, PROVIDER_LABEL, formatAlt, formatDeg, formatFpm, formatKt, traceSourceLabel } from './format';

export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export function useAircraftDetail(hex: string | null) {
  return useQuery({
    queryKey: ['aircraft', hex],
    queryFn: ({ signal }) => getJson<AircraftDetail>(`/api/aircraft?icao24=${encodeURIComponent(hex!)}`, signal),
    enabled: !!hex && /^[0-9a-f]{6}$/.test(hex),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

/** Position grid (degrees) for the route query: ~55 km, so the key changes every few minutes. */
export const ROUTE_POS_STEP_DEG = 0.5;
/** Ground-speed band (kt) for the route query. */
export const ROUTE_SPEED_STEP_KT = 50;

/** Nearest multiple of `step` (never -0, so equal cells give equal keys). */
const quantise = (v: number, step: number) => Math.round(v / step) * step || 0;

/**
 * Query key and URL for /api/flight-route (MINOR-4). The position is quantised to a 0.5° grid and
 * the speed to 50 kt bands so the key does not change on every poll (each change is a request to a
 * rate-limited route); the server's plausibility gate still sees a position within ~40 km.
 */
export function flightRouteQuery(callsign: string, pos: { lat: number; lng: number; gsKt: number | null; trackDeg?: number | null } | null): { key: readonly unknown[]; url: string } {
  const lat = pos ? Math.max(-90, Math.min(90, quantise(pos.lat, ROUTE_POS_STEP_DEG))) : null;
  let lng = pos ? quantise(pos.lng, ROUTE_POS_STEP_DEG) : null;
  if (lng !== null && (lng > 180 || lng <= -180)) lng = lng > 0 ? lng - 360 : lng + 360;
  const speed = pos?.gsKt != null ? Math.min(2000, quantise(pos.gsKt, ROUTE_SPEED_STEP_KT)) : null;
  const q = new URLSearchParams({ callsign });
  if (lat !== null && lng !== null) {
    q.set('lat', String(lat));
    q.set('lng', String(lng));
  }
  if (speed !== null) q.set('speed', String(speed));
  // Track to 45° sectors: enough to tell the legs of a round trip apart without refetching per poll.
  const track = pos?.trackDeg != null ? (Math.round(pos.trackDeg / 45) * 45) % 360 : null;
  if (track !== null) q.set('track', String(track));
  return { key: track === null ? ['flight-route', callsign, lat, lng, speed] : ['flight-route', callsign, lat, lng, speed, track], url: `/api/flight-route?${q}` };
}

export function useFlightRoute(callsign: string | null, pos: { lat: number; lng: number; gsKt: number | null; trackDeg?: number | null } | null) {
  const { key, url } = callsign ? flightRouteQuery(callsign, pos) : { key: ['flight-route', null] as const, url: '' };
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => getJson<FlightRoute>(url, signal),
    enabled: !!callsign,
    staleTime: 5 * 60_000,
    // While the next grid cell's answer loads keep the same flight's previous answer (never
    // another aircraft's).
    placeholderData: (prev, prevQuery) => (prev && prevQuery?.queryKey[1] === callsign ? prev : undefined),
  });
}

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

const hhmmss = (ms: number) => new Date(ms).toISOString().slice(11, 19) + 'Z';

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{label}</dt>
      <dd className="truncate font-mono text-[11px] uppercase tabular-nums tracking-[0.08em] text-[var(--text-primary)]">{value}</dd>
    </div>
  );
}

export function FreshnessBadge({ state, at, now }: { state: FreshnessState; at: number | null; now: number }) {
  return (
    <span
      data-testid="freshness-badge"
      className="rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tabular-nums tracking-[0.16em]"
      style={{ color: `var(${FRESHNESS_COLOR_TOKEN[state]})`, borderColor: `var(${FRESHNESS_COLOR_TOKEN[state]})` }}
    >
      {freshnessLabel(state, at, now)}
    </span>
  );
}

export default function AircraftCard({ selection }: CardProps) {
  const now = useNow();
  const { data: flights } = useFlights(true);
  const snapshot = selection.data as unknown as FlightRecord;
  const live = flights?.byId.get(selection.id) ?? null;
  const r: FlightRecord = live ?? snapshot;
  const layer = (selection.layer ?? BUCKET_LAYER[r.bucket]) as LayerId;
  const status = useLayerStatus(layer);
  // The feed's own state, not the rail state: the rail is downgraded when most of the layer's
  // positions are past the 60 s cap, which says nothing about this aircraft's own observation.
  const feedState: FreshnessState = flights?.meta.state ?? (status.state === 'idle' || status.state === 'loading' ? 'recent' : status.state);
  const observedMs = r.seenAt * 1000;
  const state = entityFreshness({ kind: 'live', at: observedMs, observationCadenceMs: OBSERVATION_CADENCE_MS[layer], feedState, now });
  const reckoned = deadReckon(r, now);
  const detail = useAircraftDetail(/^[0-9a-f]{6}$/.test(r.id) ? r.id : null);
  const route = useFlightRoute(r.callsign, r.onGround ? null : { lat: r.lat, lng: r.lng, gsKt: r.gsKt, trackDeg: r.trackDeg });
  const watched = useUiStore((s) => s.watchedFlights.includes(r.id));
  const watchCount = useUiStore((s) => s.watchedFlights.length);
  const watchFlight = useUiStore((s) => s.watchFlight);
  const unwatchFlight = useUiStore((s) => s.unwatchFlight);
  const openPanel = useUiStore((s) => s.setOpenPanel);
  const setFlightIdent = useUiStore((s) => s.setFlightIdent);
  const id = detail.data?.identity ?? null;
  const posSource = r.posSource ? POS_SOURCE_LABEL[r.posSource] : traceSourceLabel(detail.data?.trackSource ?? null);
  const airline = airlineCodeOf(r.callsign);

  return (
    <div data-testid="aircraft-card" className="flex flex-col gap-3 text-[var(--text-primary)]">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-mono text-[17px] uppercase tracking-[0.08em] text-[var(--text-heading)]">
            <Plane aria-hidden className="size-4 shrink-0 text-[var(--gold-primary)]" />
            <span className="truncate">{r.callsign ?? r.registration ?? r.id.toUpperCase()}</span>
          </h2>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
            ICAO {r.id.toUpperCase()} · {BUCKET_LABEL[r.bucket]}
            {r.isHelicopter ? ' · ROTORCRAFT' : ''}
            {airline ? ` · ${airline}` : ''}
          </p>
        </div>
        <FreshnessBadge state={state} at={observedMs} now={now} />
      </header>

      {r.emergency && (
        <p role="alert" className="flex items-center gap-2 rounded-md border border-[var(--alert-red)] px-2 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--alert-red)]">
          <TriangleAlert aria-hidden className="size-4" /> SQUAWK {EMERGENCY_LABEL[r.emergency]}
        </p>
      )}

      <dl className="grid grid-cols-3 gap-x-3 gap-y-2">
        <Field label="ALT" value={formatAlt(r)} />
        <Field label="GS" value={formatKt(r.gsKt)} />
        <Field label="TRK" value={formatDeg(r.trackDeg)} />
        <Field label="V/S" value={formatFpm(r.vrFpm)} />
        <Field label="SQUAWK" value={r.squawk ?? '—'} />
        <Field label="TYPE" value={r.typeCode ?? id?.typeCode ?? '—'} />
        <Field label="REG" value={r.registration ?? id?.registration ?? '—'} />
        <Field label="CAT" value={r.category ?? '—'} />
        <Field label="POS" value={`${reckoned.lat.toFixed(3)}, ${reckoned.lng.toFixed(3)}`} />
      </dl>

      <section aria-label="Airframe" className="flex gap-3">
        {id?.photoThumbUrl && (
          <a href={id.photoUrl ?? id.photoThumbUrl} target="_blank" rel="noopener noreferrer" className="shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element -- third-party thumbnail, loaded directly and never stored */}
            <img src={id.photoThumbUrl} alt={`Photo of ${id.registration ?? r.id.toUpperCase()}`} width={96} height={64} loading="lazy" referrerPolicy="no-referrer" className="h-16 w-24 rounded object-cover" />
          </a>
        )}
        <div className="min-w-0 text-[12px] leading-snug">
          {detail.isLoading ? (
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">IDENTIFYING AIRFRAME…</p>
          ) : id ? (
            <>
              <p className="truncate">{id.model ?? 'Unknown model'}</p>
              <p className="truncate text-[var(--text-secondary)]">{[id.operator, id.country].filter(Boolean).join(' · ') || 'Operator not in registry'}</p>
              {id.photoCredit && <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{id.photoCredit}</p>}
            </>
          ) : (
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{detail.isError ? 'REGISTRY UNAVAILABLE' : 'AIRFRAME NOT IN REGISTRY'}</p>
          )}
        </div>
      </section>

      <section aria-label="Route" className="font-mono text-[11px] uppercase tracking-[0.08em]">
        {!r.callsign ? (
          <p className="text-[var(--text-muted)]">NO CALLSIGN BROADCAST</p>
        ) : route.isLoading ? (
          <p className="text-[var(--text-muted)]">RESOLVING ROUTE…</p>
        ) : route.isError ? (
          <p className="text-[var(--text-muted)]">ROUTE UNAVAILABLE</p>
        ) : route.data?.found && route.data.origin && route.data.destination ? (
          <>
            <p className="flex items-center justify-between gap-2">
              <span className="truncate">{route.data.origin.iata ?? route.data.origin.icao} {route.data.origin.city ?? ''}</span>
              <span aria-hidden className="text-[var(--text-muted)]">→</span>
              <span className="truncate text-right">{route.data.destination.iata ?? route.data.destination.icao} {route.data.destination.city ?? ''}</span>
            </p>
            {route.data.progress !== null && (
              <div className="mt-1 h-0.5 w-full rounded bg-[var(--text-muted)]/25" role="progressbar" aria-label="Route progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(route.data.progress * 100)}>
                <div className="h-full rounded bg-[var(--gold-primary)]" style={{ width: `${Math.round(route.data.progress * 100)}%` }} />
              </div>
            )}
            <p className="mt-1 text-[10px] tracking-[0.16em] text-[var(--text-muted)]">
              {route.data.basis === 'corridor' ? 'ON SCHEDULED CORRIDOR' : 'SCHEDULE (NOT CONFIRMED)'} · {route.data.source?.toUpperCase()}
              {route.data.stale && route.data.sourceUpdatedAt ? ` · STALE RECORD ${route.data.sourceUpdatedAt.slice(0, 10)}` : ''}
            </p>
          </>
        ) : route.data?.implausible ? (
          <p className="text-[var(--text-muted)]">LISTED ROUTE DOES NOT MATCH POSITION</p>
        ) : (
          <p className="text-[var(--text-muted)]">NO SCHEDULED ROUTE</p>
        )}
      </section>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
        <Field label="SOURCE" value={PROVIDER_LABEL[r.source] ?? r.source} />
        <Field label="POSITION" value={posSource ?? '—'} />
        <Field label="OBSERVED" value={`${hhmmss(observedMs)} · ${formatAge(now - observedMs)} AGO`} />
        <Field label="FEED FETCHED" value={flights?.meta.fetchedAt ? hhmmss(Date.parse(flights.meta.fetchedAt)) : '—'} />
      </dl>
      {reckoned.frozen && <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--alert-orange)]">NOT RE-OBSERVED FOR {formatAge(now - observedMs)} · POSITION FROZEN</p>}
      {!live && flights && !flights.offline && <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--alert-orange)]">NO LONGER IN THE LIVE FEED</p>}

      <button
        type="button"
        aria-pressed={watched}
        onClick={() => {
          if (watched) unwatchFlight(r.id);
          else {
            watchFlight(r.id);
            openPanel('flight-watch');
          }
        }}
        className="flex min-h-11 items-center justify-center gap-2 rounded-md border border-[var(--cyan-primary)]/40 bg-[var(--cyan-primary)]/10 px-3 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--cyan-primary)] hover:bg-[var(--cyan-primary)]/20 focus-visible:outline-2 focus-visible:outline-[var(--gold-primary)]"
      >
        {watched ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
        {watched ? 'UNWATCH' : 'WATCH'}
        {!watched && watchCount >= MAX_WATCHED_FLIGHTS ? ` (REPLACES OLDEST OF ${MAX_WATCHED_FLIGHTS})` : ''}
      </button>
      {/* Hands the flight to the Flight Path Planner (planned arc, flown track, remaining leg). */}
      <button
        type="button"
        onClick={() => {
          setFlightIdent((r.callsign ?? r.id.replace(/^~/, '')).toUpperCase());
          openPanel('paths');
        }}
        className="flex min-h-11 items-center justify-center gap-2 rounded-md border border-[var(--gold-primary)]/40 bg-[var(--gold-primary)]/10 px-3 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--gold-primary)] hover:bg-[var(--gold-primary)]/20 focus-visible:outline-2 focus-visible:outline-[var(--gold-primary)]"
      >
        <Route aria-hidden className="size-4" />
        SHOW PLANNED PATH
      </button>
      <p className="text-[12px] text-[var(--text-secondary)]">
        Aircraft data © adsb.lol contributors, ODbL 1.0 · registry adsbdb.com ·{' '}
        <a className="underline" href={`https://globe.adsb.lol/?icao=${encodeURIComponent(r.id.replace(/^~/, ''))}`} target="_blank" rel="noopener noreferrer">
          adsb.lol globe
        </a>
      </p>
    </div>
  );
}
