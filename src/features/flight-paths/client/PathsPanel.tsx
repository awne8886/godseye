'use client';
/**
 * PATHS tool panel (§8): plan A → B (airport search with metro chips, swap, all-airfields mode),
 * the planned route summary (distance, bearing, block estimates with their method, time zones,
 * daylight strip), path-type legend (FILED / TYPICAL / GREAT-CIRCLE ESTIMATE, only what exists),
 * METAR chips by flight category, known services with LIVE badges, historical airlines (2014),
 * filed plans, diversion airports, winds aloft; LIVE aircraft on the pair (matched vs inferred);
 * FLIGHT tracking by callsign / flight number / registration / hex (`?flight=`).
 * Client-only.
 */
import { useEffect, useId, useState, type ReactNode } from 'react';
import { ArrowLeftRight, ExternalLink, Plane, Route, Search } from 'lucide-react';
import type { PanelProps } from '@/lib/feature-module';
import { usePanelChip } from '@/components/hud/PanelChrome';
import { useUiStore } from '@/lib/store';
import { parseRouteParam } from '@/lib/url-state';
import { draftMessage, setPathsDraft, usePathsDraft } from './draft';
import { ApiFailure, getJson, searchUrl, useAirportSearch, useFlight, useLive, usePlan, type Flight, type Live, type Plan, type Search as SearchResponse } from './api';
import { Profile } from './Profile';
import { FLT_TOKEN, PATH_TYPES, TWILIGHT_TOKEN, codeOf, fmtKm, fmtLocal, fmtMinutes, fmtNm, fmtOffsetHours, fmtUtc } from './format';

type Mode = 'route' | 'live' | 'flight';
type Weather = Plan['weather']['origin'];

const SAMPLES: { label: string; from?: string; to?: string; flight?: string }[] = [
  { label: 'LHR → JFK', from: 'LHR', to: 'JFK' },
  { label: 'KSFO → RJTT', from: 'KSFO', to: 'RJTT' },
  { label: 'Heathrow → Dubai', from: 'LHR', to: 'DXB' },
  { label: 'BA117', flight: 'BA117' },
];

function Section({ title, count, children, open = false }: { title: string; count?: number; children: ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group border-t border-[var(--border-secondary)] py-2">
      <summary className="hud-text flex cursor-pointer list-none items-center justify-between text-[11px] text-[var(--text-heading)] focus-visible:outline focus-visible:outline-[var(--gold-primary)]">
        <span>{title}</span>
        {count !== undefined && <span className="text-[var(--text-secondary)]">{count}</span>}
      </summary>
      <div className="pt-2">{children}</div>
    </details>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="hud-micro text-[var(--text-muted)]">{label}</span>
      <span className="hud-text text-[12px] text-[var(--text-primary)]">{value}</span>
    </div>
  );
}

function Note({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'warn' | 'error' }) {
  const color = tone === 'error' ? 'var(--alert-red)' : tone === 'warn' ? 'var(--alert-orange)' : 'var(--text-secondary)';
  return (
    <p className="font-sans text-[12px] leading-snug" style={{ color }}>
      {children}
    </p>
  );
}

export function MetarChip({ code, wx }: { code: string; wx: Weather | null }) {
  if (!wx || !wx.metar) {
    return (
      <div className="hud-chip border border-[var(--border-secondary)] px-2 py-1">
        <span className="hud-text text-[11px] text-[var(--text-secondary)]">{code} · NO METAR</span>
      </div>
    );
  }
  const cat = wx.fltCat;
  return (
    <div className="hud-chip flex flex-col gap-1 border px-2 py-1" style={{ borderColor: cat ? FLT_TOKEN[cat] : 'var(--border-secondary)' }}>
      <span className="hud-text flex items-center gap-2 text-[11px]">
        <span style={{ color: cat ? FLT_TOKEN[cat] : 'var(--text-secondary)' }}>{cat ?? 'N/A'}</span>
        <span className="text-[var(--text-primary)]">{code}</span>
        <span className="text-[var(--text-muted)]">OBS {fmtUtc(wx.observedAt)}</span>
      </span>
      <span className="font-mono text-[11px] break-words text-[var(--text-secondary)]">{wx.metar}</span>
      {wx.taf && (
        <details>
          <summary className="hud-micro cursor-pointer text-[var(--text-muted)]">TAF</summary>
          <span className="font-mono text-[11px] break-words text-[var(--text-secondary)]">{wx.taf}</span>
        </details>
      )}
    </div>
  );
}

function AirportField({ label, value, onPick, all }: { label: string; value: string; onPick: (code: string) => void; all: boolean }) {
  const [text, setText] = useState(value);
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const id = useId();
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    // Parent changed the code (swap, sample chip): show it (React's "adjust state on prop change").
    setPrevValue(value);
    setText(value);
  }
  useEffect(() => {
    const t = setTimeout(() => setDebounced(text), 200);
    return () => clearTimeout(t);
  }, [text]);
  const search = useAirportSearch(open ? debounced : '', all);
  const results = search.data?.results ?? [];
  const pick = (code: string) => {
    onPick(code);
    setText(code);
    setOpen(false);
  };
  return (
    <div className="relative flex-1">
      <label htmlFor={id} className="hud-micro text-[var(--text-muted)]">
        {label}
      </label>
      <input
        id={id}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          onPick(e.target.value.trim().toUpperCase());
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && results[0]) pick(codeOf(results[0]));
          // An explicit submit with no local match may use the server's Nominatim fallback.
          else if (e.key === 'Enter' && text.trim().length >= 3 && !/^[A-Z0-9]{3,4}$/i.test(text.trim())) {
            e.preventDefault();
            void getJson<SearchResponse>(searchUrl(text.trim(), all, true)).then(
              (r) => r.results[0] && pick(codeOf(r.results[0])),
              () => undefined,
            );
          }
          if (e.key === 'Escape') setOpen(false);
        }}
        placeholder="IATA / CITY"
        autoComplete="off"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={`${id}-list`}
        className="hud-text hud-control mt-1 w-full border border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-2 py-1.5 text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus-visible:outline focus-visible:outline-[var(--gold-primary)]"
      />
      {open && search.data?.metro && (
        <div className="mt-1 flex flex-wrap gap-1" aria-label={`${search.data.metro.name} airports`}>
          {search.data.metro.codes.map((c) => (
            <button key={c} type="button" onClick={() => pick(c)} className="hud-chip hud-text border border-[var(--border-active)] px-1.5 py-0.5 text-[11px] text-[var(--gold-light)]">
              {c}
            </button>
          ))}
        </div>
      )}
      {open && results.length > 0 && (
        <ul id={`${id}-list`} role="listbox" className="glass-panel absolute right-0 left-0 z-10 mt-1 max-h-56 overflow-y-auto p-1">
          {results.slice(0, 8).map((r) => (
            <li key={r.ident} role="option" aria-selected={false}>
              <button type="button" onClick={() => pick(codeOf(r))} className="flex w-full items-baseline gap-2 px-2 py-1 text-left hover:bg-[var(--glass-2)]">
                <span className="hud-text w-10 text-[11px] text-[var(--gold-light)]">{codeOf(r)}</span>
                <span className="flex-1 truncate font-sans text-[12px] text-[var(--text-primary)]">{r.name}</span>
                <span className="hud-micro text-[var(--text-muted)]">{r.isoCountry}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Legend({ labels }: { labels: Plan['pathLabels'] }) {
  return (
    <ul className="flex flex-col gap-1" aria-label="Path types">
      {PATH_TYPES.map((t) => {
        const on = (labels as readonly string[]).includes(t.label);
        return (
          <li key={t.label} className="flex items-start gap-2" data-available={on}>
            {/* Unavailability is carried by the dashed swatch and the words, never by dimmed text (≥ 4.5:1). */}
            {on ? (
              <span aria-hidden className="mt-1.5 inline-block h-0.5 w-5 shrink-0" style={{ background: t.token }} />
            ) : (
              <span aria-hidden className="mt-1.5 inline-block w-5 shrink-0 border-t border-dashed border-[var(--border-active)]" />
            )}
            <span className="flex flex-col">
              <span className="hud-text text-[11px]" style={{ color: on ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                {t.label}
                {on ? '' : ' · NOT AVAILABLE'}
              </span>
              <span className="font-sans text-[12px] text-[var(--text-secondary)]">{t.meaning}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Sources({ providers }: { providers: Plan['providers'] }) {
  return (
    <ul className="flex flex-wrap gap-1" aria-label="Sources">
      {Object.entries(providers).map(([k, p]) => (
        <li
          key={k}
          className="hud-chip hud-micro border px-1.5 py-0.5"
          style={{ borderColor: p.ok ? 'var(--border-secondary)' : 'var(--alert-orange)', color: p.ok ? 'var(--text-secondary)' : 'var(--alert-orange)' }}
          title={p.skipped ? `skipped: ${p.skipped}` : p.error ? `error: ${p.error}` : `${p.count} records`}
        >
          {k.replace(/_/g, ' ')} {p.ok ? '' : p.skipped ? `· ${p.skipped}` : '· offline'}
        </li>
      ))}
    </ul>
  );
}

export function PlanView({ plan }: { plan: Plan }) {
  const o = plan.origin;
  const d = plan.destination;
  const wide = plan.estimates.byClass.widebody;
  const flightsOk = plan.providers.flights?.ok === true;
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="hud-text text-[13px] text-[var(--text-heading)]">
          {codeOf(o)} → {codeOf(d)}
        </p>
        <p className="font-sans text-[12px] text-[var(--text-secondary)]">
          {o.name} → {d.name}
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2" aria-label="Route summary">
        <Stat
          label="DISTANCE"
          value={
            <>
              <span className="block whitespace-nowrap">{fmtKm(plan.greatCircle.distanceKm)}</span>
              <span className="block whitespace-nowrap text-[var(--text-secondary)]">{fmtNm(plan.greatCircle.distanceNm)}</span>
            </>
          }
        />
        <Stat label="BEARING" value={`${Math.round(plan.greatCircle.initialBearing)}° → ${Math.round(plan.greatCircle.finalBearing)}°`} />
        <Stat label="EST. BLOCK" value={fmtMinutes(wide.blockMinutes)} />
        <Stat label="TZ Δ" value={fmtOffsetHours(plan.timezones.offsetHours)} />
        <Stat label={`LOCAL ${codeOf(o)}`} value={fmtLocal(plan.timezones.origin.localNow)} />
        <Stat label={`LOCAL ${codeOf(d)}`} value={fmtLocal(plan.timezones.destination.localNow)} />
      </div>
      {(plan.greatCircle.polar || plan.greatCircle.antimeridianCrossings > 0) && (
        <p className="hud-micro text-[var(--cyan-primary)]">
          {plan.greatCircle.polar ? 'POLAR ROUTE' : ''}
          {plan.greatCircle.polar && plan.greatCircle.antimeridianCrossings ? ' · ' : ''}
          {plan.greatCircle.antimeridianCrossings ? 'CROSSES THE ANTIMERIDIAN' : ''}
        </p>
      )}
      <Legend labels={plan.pathLabels} />
      <div className="flex flex-col gap-1">
        <span className="hud-micro text-[var(--text-muted)]">DAYLIGHT ALONG THE PATH (DEPARTING NOW)</span>
        <div className="flex h-3 overflow-hidden rounded-sm border border-[var(--border-secondary)]" role="img" aria-label={`Daylight: ${plan.daylight.map((s) => s.twilight).join(', ')}`}>
          {plan.daylight.map((s, i) => (
            <span key={i} className="flex-1" style={{ background: TWILIGHT_TOKEN[s.twilight] }} title={`${Math.round(s.fraction * 100)} %: ${s.twilight}`} />
          ))}
        </div>
        <span className="hud-micro text-[var(--text-secondary)]">
          {(['day', 'civil', 'nautical', 'astronomical', 'night'] as const)
            .map((t) => [t, plan.daylight.filter((s) => s.twilight === t).length] as const)
            .filter(([, n]) => n > 0)
            .map(([t, n]) => `${t.toUpperCase()} ${n}/10`)
            .join(' · ')}
        </span>
        {plan.daylightMethod && <Note>{plan.daylightMethod}</Note>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <MetarChip code={codeOf(o)} wx={plan.weather.origin} />
        <MetarChip code={codeOf(d)} wx={plan.weather.destination} />
      </div>
      <Section title="BLOCK-TIME ESTIMATES" open>
        <table className="w-full font-mono text-[11px] text-[var(--text-secondary)]">
          <tbody>
            {Object.entries(plan.estimates.byClass).map(([k, e]) => (
              <tr key={k}>
                <td className="hud-text py-0.5 text-[var(--text-primary)]">{k}</td>
                <td>{e.cruiseKts} KT</td>
                <td className="text-right">{fmtMinutes(e.blockMinutes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Note>{plan.estimates.method}</Note>
      </Section>
      <Section title="KNOWN SERVICES" count={plan.knownServices.length} open={plan.knownServices.length > 0}>
        {!flightsOk && <Note tone="warn">Live feed offline — LIVE badges unavailable.</Note>}
        {plan.knownServices.length === 0 ? (
          <Note>No scheduled service in the standing data — showing great circle only.</Note>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {plan.knownServices.map((s) => (
              <li key={s.callsign} className="flex items-center gap-2 font-mono text-[11px]">
                <span className="w-16 text-[var(--text-primary)]">{s.callsign}</span>
                <span className="flex-1 truncate font-sans text-[12px] text-[var(--text-secondary)]">{s.airline.name ?? s.airline.icao ?? ''}</span>
                {s.airportCodes.length > 2 && <span className="hud-micro text-[var(--text-muted)]">{s.airportCodes.join('-')}</span>}
                {s.live && <span className="hud-chip hud-micro border border-[var(--alert-green)] px-1 text-[var(--alert-green)]">LIVE</span>}
              </li>
            ))}
          </ul>
        )}
        <Note>Callsigns from VRS standing data (CC0), as last reported — no dates or days of operation.</Note>
      </Section>
      <Section title="HISTORICAL AIRLINES (2014)" count={plan.historicalRoutes.length}>
        {plan.historicalRoutes.length === 0 ? (
          <Note>None in the OpenFlights 2014 dataset.</Note>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {plan.historicalRoutes.map((h, i) => (
              <li key={`${h.airline}-${i}`} className="flex gap-2 font-sans text-[12px] text-[var(--text-secondary)]">
                <span className="flex-1 truncate text-[var(--text-primary)]">{h.airline}</span>
                {h.codeshare && <span className="hud-micro">CODESHARE</span>}
                <span className="font-mono text-[11px]">{h.equipment.join(' ')}</span>
              </li>
            ))}
          </ul>
        )}
        <Note>OpenFlights (ODbL) route data stopped updating in June 2014 — historical only.</Note>
      </Section>
      {plan.filedPlans && plan.filedPlans.length > 0 && (
        <Section title="FILED PLANS" count={plan.filedPlans.length}>
          {plan.filedPlans.map((f) => (
            <div key={f.id} className="flex flex-col gap-1">
              <span className="hud-text text-[11px] text-[var(--cyan-primary)]">
                {f.source} · {f.waypoints.length} WPTS{f.distanceNm !== null ? ` · ${f.distanceNm} NM` : ''}
              </span>
              <span className="font-mono text-[11px] break-words text-[var(--text-secondary)]">{f.waypoints.map((w) => w.ident).join(' ')}</span>
              <Note tone="warn">{f.disclaimer}</Note>
            </div>
          ))}
        </Section>
      )}
      <Section title="DIVERSION AIRPORTS" count={plan.diversionAirports.length}>
        <ul className="flex flex-col gap-0.5">
          {plan.diversionAirports.map((a) => (
            <li key={a.code} className="flex gap-2 font-mono text-[11px] text-[var(--text-secondary)]">
              <span className="w-10 text-[var(--text-primary)]">{a.code}</span>
              <span className="flex-1 truncate font-sans text-[12px]">{a.name}</span>
              <span>{a.runwayM} M</span>
              <span>{Math.round(a.alongPathKm)} KM</span>
            </li>
          ))}
        </ul>
        {plan.diversionMethod && <Note>{plan.diversionMethod}</Note>}
      </Section>
      <Section title="WEATHER ALONG ROUTE" count={plan.weather.windsAloft.length}>
        {plan.weather.windsAloft.length === 0 ? (
          <Note>{plan.providers.openmeteo?.skipped ? `Winds aloft skipped (${plan.providers.openmeteo.skipped}).` : 'Winds aloft unavailable.'}</Note>
        ) : (
          <ul className="flex flex-col gap-0.5 font-mono text-[11px] text-[var(--text-secondary)]">
            {plan.weather.windsAloft.map((w) => (
              <li key={w.fraction} className="flex gap-2">
                <span className="w-10">{Math.round(w.fraction * 100)} %</span>
                <span className="flex-1">
                  {w.lat.toFixed(1)}, {w.lng.toFixed(1)}
                </span>
                <span>{w.dirDeg !== null && w.speedKt !== null ? `${Math.round(w.dirDeg)}° / ${Math.round(w.speedKt)} KT` : '—'}</span>
              </li>
            ))}
          </ul>
        )}
        <Note>250 hPa (≈ FL340) model forecast for the current hour, Open-Meteo (CC BY 4.0).</Note>
      </Section>
      <Sources providers={plan.providers} />
      <Note>Airports: OurAirports (public domain) + mwgg/Airports time zones (MIT). METAR/TAF: aviationweather.gov. Planning aid only — not for navigation.</Note>
    </div>
  );
}

/** Header chip for the live tab (R2-M2): matched and inferred are never summed into one count. */
export function liveCounts(aircraft: readonly { basis: 'matched' | 'inferred' }[]): string {
  const m = aircraft.filter((a) => a.basis === 'matched').length;
  return `${m} MATCHED · ${aircraft.length - m} INFERRED`;
}

export function LiveView({ live, error }: { live: Live | undefined; error: unknown }) {
  if (error instanceof ApiFailure && error.status === 503) {
    const last = error.meta?.lastGoodAt;
    return <Note tone="warn">Live feed offline{last ? ` — last snapshot ${fmtUtc(last)}` : ' — no snapshot yet'}.</Note>;
  }
  if (!live) return <Note>Loading live aircraft…</Note>;
  const partial = live.coverage && !live.coverage.complete ? live.coverage : null;
  const partialNote = partial && (
    <Note tone="warn">
      PARTIAL SNAPSHOT — {partial.tilesRead} of {partial.tilesTotal} coverage tiles read so far; aircraft on this pair may be missing.
    </Note>
  );
  if (!live.aircraft.length) {
    return partialNote ? (
      <div className="flex flex-col gap-2" data-testid="paths-live-partial">
        {partialNote}
        <Note>None found yet in the tiles read ({fmtUtc(live.snapshotAt)}).</Note>
      </div>
    ) : (
      <Note>No aircraft on this pair in the current snapshot ({fmtUtc(live.snapshotAt)}).</Note>
    );
  }
  const anyInferred = live.aircraft.some((a) => a.basis === 'inferred');
  return (
    <div className="flex flex-col gap-2">
      <p className="hud-micro text-[var(--text-secondary)]" data-testid="paths-live-counts">
        {liveCounts(live.aircraft)}
      </p>
      {partialNote}
      {anyInferred && <Note>~ INFERRED: no known route for the callsign; position, track and altitude fit the corridor only. Shown as a dotted ring (◌) on the map, without a progress chip.</Note>}
      <ul className="flex flex-col gap-2" aria-label="Live aircraft on the route">
        {live.aircraft.map((a) => (
          <li key={a.hex} className="flex flex-col gap-1 border-b border-[var(--border-secondary)] pb-1.5">
            <div className="hud-text flex items-center gap-2 text-[11px]">
              <span className={a.basis === 'matched' ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}>
                {a.basis === 'matched' ? '' : '~'}
                {a.callsign ?? a.hex}
              </span>
              <span
                className="hud-chip hud-micro border px-1"
                style={{ borderColor: a.basis === 'matched' ? 'var(--alert-green)' : 'var(--alert-orange)', color: a.basis === 'matched' ? 'var(--alert-green)' : 'var(--alert-orange)' }}
                title={a.basis === 'matched' ? 'Callsign is a known service on this pair (VRS standing data)' : 'Inferred from position, heading and altitude only'}
              >
                {a.basis === 'matched' ? 'MATCHED' : 'INFERRED'}
              </span>
              <span className="text-[var(--text-muted)]">{a.direction === 'forward' ? '→' : '←'}</span>
              <span className="ml-auto text-[var(--text-secondary)]">ETA {fmtLocal(a.etaLocal)}</span>
            </div>
            <div className="h-1 w-full rounded-full bg-[var(--bg-tertiary)]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(a.progress * 100)} aria-label={`${a.callsign ?? a.hex} progress`}>
              <div className={`h-1 rounded-full ${a.basis === 'matched' ? 'bg-[var(--gold-primary)]' : 'bg-[var(--text-muted)]'}`} style={{ width: `${Math.round(a.progress * 100)}%` }} />
            </div>
            <span className="hud-micro text-[var(--text-muted)]">
              {a.altFt !== null ? `${Math.round(a.altFt / 100)} FL` : 'ALT —'} · {a.gsKt !== null ? `${Math.round(a.gsKt)} KT` : 'GS —'} · {Math.round(a.remainingKm)} KM TO GO · OBS {fmtUtc(a.observedAt)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FlightView({ flight }: { flight: Flight }) {
  const o = flight.origin;
  const d = flight.destination;
  const id = flight.identity;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Plane size={14} aria-hidden className="text-[var(--gold-primary)]" />
        <span className="hud-text text-[13px] text-[var(--text-heading)]">{flight.resolved.callsign ?? flight.resolved.hex ?? flight.ident}</span>
        {flight.resolved.iataFlight && <span className="hud-micro text-[var(--text-secondary)]">{flight.resolved.iataFlight}</span>}
        <span className="hud-chip hud-micro ml-auto border border-[var(--border-active)] px-1.5 text-[var(--gold-light)]">{flight.status.toUpperCase()}</span>
      </div>
      {o && d ? (
        <>
          <p className="font-sans text-[12px] text-[var(--text-secondary)]">
            {flight.routeBasis === 'observed-reverse' && <span className="hud-micro mr-1 text-[var(--cyan-primary)]">AS FLOWN (OBSERVED)</span>}
            {codeOf(o)} {o.name} → {codeOf(d)} {d.name}
            {flight.routeSource?.stale ? ' (stale route record)' : ''}
          </p>
          {flight.routeCheck && <Note>{flight.routeCheck}</Note>}
        </>
      ) : (
        <Note>{flight.routeCheck ? `No corroborated route: ${flight.routeCheck}.` : 'No corroborated route for this flight.'}</Note>
      )}
      {flight.progress !== null && (
        <div className="h-1.5 w-full rounded-full bg-[var(--bg-tertiary)]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(flight.progress * 100)} aria-label="Flight progress">
          <div className="h-1.5 rounded-full bg-[var(--gold-primary)]" style={{ width: `${Math.round(flight.progress * 100)}%` }} />
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        <Stat label="ETA" value={fmtLocal(flight.etaLocal)} />
        <Stat label="ALT" value={flight.position?.altFt != null ? `${flight.position.altFt.toLocaleString('en-US')} FT` : '—'} />
        <Stat label="GS" value={flight.position?.gsKt != null ? `${Math.round(flight.position.gsKt)} KT` : '—'} />
        <Stat label="POSITION OBS" value={fmtUtc(flight.position?.observedAt)} />
        <Stat label="TYPE" value={id?.typeCode ?? '—'} />
        <Stat label="REG" value={flight.resolved.registration ?? '—'} />
      </div>
      {id?.operator && <Note>Operator: {id.operator}</Note>}
      {flight.flownTrack.length > 1 && <Profile track={flight.flownTrack} />}
      <div className="grid grid-cols-2 gap-2">
        {o && <MetarChip code={codeOf(o)} wx={flight.weather.origin} />}
        {d && <MetarChip code={codeOf(d)} wx={flight.weather.destination} />}
      </div>
      <ul className="flex flex-wrap gap-2" aria-label="External trackers">
        {flight.links.map((l) => (
          <li key={l.label}>
            <a href={l.url} target="_blank" rel="noopener noreferrer" className="hud-text inline-flex items-center gap-1 text-[11px] text-[var(--cyan-primary)] hover:underline">
              {l.label} <ExternalLink size={11} aria-hidden />
            </a>
          </li>
        ))}
      </ul>
      <ul className="flex flex-col gap-0.5" aria-label="Source status">
        {flight.sources.map((s) => (
          <li key={s.name} className="font-sans text-[12px]" style={{ color: s.ok ? 'var(--text-secondary)' : 'var(--alert-orange)' }}>
            {s.name}: {s.detail ?? (s.ok ? 'ok' : 'unavailable')}
          </li>
        ))}
      </ul>
      <Sources providers={flight.providers} />
    </div>
  );
}

function failureText(e: unknown): string {
  if (e instanceof ApiFailure) {
    if (e.status === 404) return `${(e.detail ?? 'Unknown airport').replace(/\.$/, '')} — check the code.`;
    if (e.status === 503) return `SOURCE OFFLINE — ${e.detail ?? 'an upstream did not answer'}`;
    if (e.status === 400) return e.detail ?? 'That input is not valid.';
    return e.detail ?? `Request failed (${e.code}).`;
  }
  return 'Request failed.';
}

export default function PathsPanel(_props: PanelProps) {
  const route = useUiStore((s) => s.plannedRoute);
  const ident = useUiStore((s) => s.flightIdent);
  const setPlannedRoute = useUiStore((s) => s.setPlannedRoute);
  const setFlightIdent = useUiStore((s) => s.setFlightIdent);
  const [mode, setMode] = useState<Mode>(ident && !route ? 'flight' : 'route');
  const [from, setFrom] = useState(route?.from ?? '');
  const [to, setTo] = useState(route?.to ?? '');
  const [all, setAll] = useState(false);
  const [identText, setIdentText] = useState(ident ?? '');
  // A typed route the palette could not resolve: pre-fill FROM/TO and say so (R4-m6).
  const draft = usePathsDraft();
  const [seenDraft, setSeenDraft] = useState(0);
  if (draft && draft.seq !== seenDraft) {
    setSeenDraft(draft.seq);
    setFrom(draft.from);
    setTo(draft.to);
    setMode('route');
  }
  const draftNotice = draft && draft.seq === seenDraft ? draftMessage(draft) : null;

  const plan = usePlan(route);
  const live = useLive(route, mode === 'live');
  const flight = useFlight(mode === 'flight' ? ident : null);

  const chip: [string, 'idle' | 'busy' | 'live' | 'warn' | 'error'] =
    mode === 'flight'
      ? flight.isFetching
        ? ['PLOTTING', 'busy']
        : flight.data
          ? [flight.data.status === 'airborne' ? 'LIVE' : flight.data.status.toUpperCase(), flight.data.status === 'airborne' ? 'live' : 'idle']
          : flight.error
            ? ['ERROR', 'error']
            : ['STANDBY', 'idle']
      : plan.isFetching
        ? ['PLOTTING', 'busy']
        : plan.data
          ? mode === 'live' && live.data
            ? [liveCounts(live.data.aircraft), 'live']
            : [`${Math.round(plan.data.greatCircle.distanceKm).toLocaleString('en-US')} KM`, 'idle']
          : plan.error
            ? ['ERROR', 'error']
            : ['STANDBY', 'idle'];
  usePanelChip(chip[0], chip[1]);

  const plot = (a = from, b = to) => {
    const r = parseRouteParam(`${a.trim()}~${b.trim()}`);
    if (!r) return;
    setPathsDraft(null);
    setFlightIdent(null);
    setPlannedRoute(r);
    setMode('route');
  };
  const track = (v = identText) => {
    const id = v.trim().toUpperCase().replace(/\s+/g, '');
    if (!/^[A-Z0-9-]{2,10}$/.test(id)) return;
    setPlannedRoute(null);
    setFlightIdent(id);
    setMode('flight');
  };

  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="Flight paths mode" className="grid grid-cols-3 gap-1">
        {(['route', 'live', 'flight'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className="hud-text hud-control border py-1 text-[11px]"
            style={{ borderColor: mode === m ? 'var(--border-active)' : 'var(--border-secondary)', color: mode === m ? 'var(--gold-light)' : 'var(--text-secondary)' }}
          >
            {m.toUpperCase()}
          </button>
        ))}
      </div>

      {mode !== 'flight' && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            plot();
          }}
        >
          <div className="flex items-end gap-2">
            <AirportField label="FROM" value={from} onPick={setFrom} all={all} />
            <button
              type="button"
              aria-label="Swap origin and destination"
              onClick={() => {
                setFrom(to);
                setTo(from);
                if (route) plot(to, from);
              }}
              className="hud-control mb-0.5 grid h-8 w-8 place-items-center border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--gold-light)]"
            >
              <ArrowLeftRight size={14} />
            </button>
            <AirportField label="TO" value={to} onPick={setTo} all={all} />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-pressed={all}
              onClick={() => setAll((v) => !v)}
              className="hud-micro inline-flex min-h-11 items-center gap-2 whitespace-nowrap text-[var(--text-secondary)] md:min-h-8"
            >
              <span aria-hidden className="hud-toggle" data-on={all}>
                <span className="h-2.5 w-2.5 rounded-full bg-current" />
              </span>
              ALL AIRFIELDS
            </button>
            <button type="submit" className="hud-text hud-control ml-auto inline-flex items-center gap-1 border border-[var(--border-active)] px-3 py-1 text-[11px] text-[var(--gold-light)]">
              <Route size={12} aria-hidden /> PLOT
            </button>
          </div>
          {draftNotice && (
            <p role="status" className="font-sans text-[12px] text-[var(--alert-orange)]">
              {draftNotice}
            </p>
          )}
        </form>
      )}

      {mode === 'flight' && (
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            track();
          }}
        >
          <label className="flex flex-1 flex-col">
            <span className="hud-micro text-[var(--text-muted)]">CALLSIGN, FLIGHT, REGISTRATION OR HEX</span>
            <input
              value={identText}
              onChange={(e) => setIdentText(e.target.value)}
              placeholder="BA117 · BAW117 · G-XWBA · 4CA2B3"
              className="hud-text hud-control mt-1 w-full border border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-2 py-1.5 text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            />
          </label>
          <button type="submit" className="hud-text hud-control inline-flex items-center gap-1 border border-[var(--border-active)] px-3 py-1.5 text-[11px] text-[var(--gold-light)]">
            <Search size={12} aria-hidden /> TRACK
          </button>
        </form>
      )}

      {!route && !ident && (
        <div className="flex flex-col gap-2">
          <Note>Plot a route between two airports, or track a flight.</Note>
          <div className="flex flex-wrap gap-1">
            {SAMPLES.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => {
                  if (s.flight) {
                    setIdentText(s.flight);
                    track(s.flight);
                  } else {
                    setFrom(s.from!);
                    setTo(s.to!);
                    plot(s.from, s.to);
                  }
                }}
                className="hud-chip hud-text border border-[var(--border-secondary)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)] hover:text-[var(--gold-light)]"
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {mode === 'route' && route && (plan.data ? <PlanView plan={plan.data} /> : plan.error ? <Note tone="error">{failureText(plan.error)}</Note> : <Note>Plotting {route.from} → {route.to}…</Note>)}
      {mode === 'live' && (route ? <LiveView live={live.data} error={live.error} /> : <Note>Plot a route first to see aircraft flying it.</Note>)}
      {mode === 'flight' && ident && (flight.data ? <FlightView flight={flight.data} /> : flight.error ? <Note tone="error">{failureText(flight.error)}</Note> : <Note>Resolving {ident}…</Note>)}
    </div>
  );
}
