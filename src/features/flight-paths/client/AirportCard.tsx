'use client';
/**
 * Airport entity card body (`cards.airport`; the HUD supplies the frame): opened by a click on a
 * route endpoint or a diversion airport. The airport record and runways are bundled OurAirports
 * REFERENCE data; the METAR/TAF line is AWC's observation with its own observed time (never the
 * fetch time); local time is computed from the IANA zone. Everything upstream renders as text.
 * Client-only.
 */
import { useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import type { CardProps } from '@/lib/feature-module';
import type { AirportDetailResponse } from '@/lib/schemas/flight-paths';
import { ApiFailure, getJson } from './api';
import { codeOf, FLT_TOKEN, fmtLocal, fmtUtc } from './format';

export type AirportDetail = z.infer<typeof AirportDetailResponse>;

export const airportUrl = (code: string) => `/api/airports/${encodeURIComponent(code)}`;

/** At most this many runways listed (longest first). */
export const RUNWAYS_SHOWN = 4;

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0" data-field={label}>
      <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{label}</dt>
      <dd className="wrap-anywhere font-mono text-[11px] uppercase tabular-nums tracking-[0.08em] text-[var(--text-primary)]">{value}</dd>
    </div>
  );
}

export default function AirportCard({ selection }: CardProps) {
  const code = String((selection.data as { code?: unknown }).code ?? selection.id);
  const role = (selection.data as { role?: unknown }).role;
  const q = useQuery({
    queryKey: ['airport', code],
    queryFn: ({ signal }) => getJson<AirportDetail>(airportUrl(code), signal),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const d = q.data;
  const fallbackName = typeof (selection.data as { name?: unknown }).name === 'string' ? String((selection.data as { name: string }).name) : null;

  return (
    <div data-testid="airport-card" className="flex flex-col gap-3 text-[var(--text-primary)]">
      <header className="min-w-0">
        <h2 className="font-mono text-[17px] uppercase tracking-[0.08em] text-[var(--text-heading)]">{d ? codeOf(d.airport) : code}</h2>
        <p className="wrap-break-word text-[13px] text-[var(--text-secondary)]">{d?.airport.name ?? fallbackName ?? ''}</p>
        <p className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
          <span className="instrument-chip">REFERENCE</span>
          <span>OURAIRPORTS{role === 'diversion' ? ' · DIVERSION CANDIDATE' : role === 'endpoint' ? ' · ROUTE ENDPOINT' : ''}</span>
        </p>
      </header>

      {q.isPending && <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">LOADING…</p>}
      {q.isError && (
        <p role="alert" className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--alert-red)]">
          {q.error instanceof ApiFailure && q.error.status === 404 ? `UNKNOWN AIRPORT ${code}` : 'AIRPORT DETAILS UNAVAILABLE'}
        </p>
      )}

      {d && (
        <>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
            <Field label="ICAO / IATA" value={`${d.airport.icao ?? '—'} / ${d.airport.iata ?? '—'}`} />
            <Field label="Place" value={[d.airport.municipality, d.airport.country ?? d.airport.isoCountry].filter(Boolean).join(', ')} />
            <Field label="Elevation" value={d.airport.elevationFt !== null ? `${Math.round(d.airport.elevationFt).toLocaleString('en-US')} FT` : '—'} />
            <Field label="Local time" value={d.localTime ? `${fmtLocal(d.localTime)}${d.airport.tz ? ` ${d.airport.tz}` : ''}` : '—'} />
          </dl>

          {d.runways.length > 0 && (
            <section aria-label="Runways">
              <h3 className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Runways</h3>
              <ul className="mt-1 flex flex-col gap-0.5 font-mono text-[11px] uppercase tabular-nums tracking-[0.08em]">
                {[...d.runways]
                  .filter((r) => !r.closed)
                  .sort((a, b) => (b.lengthFt ?? 0) - (a.lengthFt ?? 0))
                  .slice(0, RUNWAYS_SHOWN)
                  .map((r, i) => (
                    <li key={`${r.leIdent}-${r.heIdent}-${i}`}>
                      {r.leIdent ?? '—'}/{r.heIdent ?? '—'} · {r.lengthFt !== null ? `${Math.round(r.lengthFt).toLocaleString('en-US')} FT` : 'LENGTH N/A'}
                      {r.surface ? ` · ${r.surface}` : ''}
                    </li>
                  ))}
              </ul>
            </section>
          )}

          <section aria-label="Weather">
            <h3 className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
              METAR
              {d.weather.fltCat && (
                <span className="instrument-chip" style={{ color: FLT_TOKEN[d.weather.fltCat] }}>
                  {d.weather.fltCat}
                </span>
              )}
              {d.weather.observedAt && <span>OBSERVED {fmtUtc(d.weather.observedAt)}</span>}
            </h3>
            <p className="mt-1 wrap-anywhere font-mono text-[11px] tracking-[0.04em] text-[var(--text-secondary)]">
              {d.weather.metar ?? (d.providers.awc_metar && !d.providers.awc_metar.ok ? 'SOURCE OFFLINE (aviationweather.gov)' : 'NO METAR REPORTED FOR THIS STATION')}
            </p>
          </section>
        </>
      )}
    </div>
  );
}
