'use client';
/**
 * SEARCH: Photon type-ahead (300 ms debounce, react-query cache), Nominatim only on an explicit
 * submit (Enter), `lat,lng` parsed instantly, fly-to on select, and a one-click "centre on my
 * region" that calls /api/geo only after that click (region-level, via this server).
 * Owner: panels-recon.
 */
import { useQuery } from '@tanstack/react-query';
import { Crosshair, LocateFixed, MapPin, Search } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { usePanelChip } from '@/components/hud/PanelChrome';
import type { PanelProps } from '@/lib/feature-module';
import { useUiStore } from '@/lib/store';
import type { GeoResponse, Place } from '@/lib/types';
import { ErrorLine, HudButton, HudInput, ProviderChips, Prose, apiGet } from '../recon/ui';
import { TYPEAHEAD_MIN_CHARS, debounce, normalizeQuery, zoomForPlace } from './debounce';

export async function fetchPlaces(q: string, submit: boolean, signal?: AbortSignal) {
  const r = await apiGet<GeoResponse>(`/api/geosearch?q=${encodeURIComponent(q)}${submit ? '&submit=1' : ''}`, signal);
  return r;
}

export default function SearchPanel(_: PanelProps) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState<{ q: string; submit: boolean } | null>(null);
  const [region, setRegion] = useState<{ state: 'idle' | 'busy' | 'error'; detail?: string }>({ state: 'idle' });
  const requestFlyTo = useUiStore((s) => s.requestFlyTo);
  const updateSettings = useUiStore((s) => s.updateSettings);
  const inputId = useId();
  const listId = useId();
  const setDebounced = useMemo(() => debounce((q: string) => setQuery(q.length >= TYPEAHEAD_MIN_CHARS ? { q, submit: false } : null)), []);
  useEffect(() => () => setDebounced.cancel(), [setDebounced]);

  const res = useQuery({
    queryKey: ['geosearch', query ? normalizeQuery(query.q) : '', query?.submit ?? false],
    queryFn: ({ signal }) => fetchPlaces(query!.q, query!.submit, signal),
    enabled: query !== null,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    retry: 0,
  });
  const body = res.data?.body;
  const results = (res.data?.ok ? body?.results : []) ?? [];
  usePanelChip(res.isFetching ? 'SEARCHING' : query ? (res.data?.ok ? `${results.length} RESULTS` : res.data ? 'SOURCE OFFLINE' : 'STANDBY') : 'STANDBY', res.isFetching ? 'busy' : res.data && !res.data.ok ? 'warn' : results.length ? 'live' : 'idle');

  const go = (p: Place) => requestFlyTo({ lat: p.lat, lng: p.lng, zoom: zoomForPlace(p.kind, p.bbox), durationMs: 2200 });

  const centreOnRegion = async () => {
    // The click is the consent: only now is the visitor's IP sent (via this server) to ipwho.is.
    updateSettings({ geoConsent: 'granted' });
    setRegion({ state: 'busy' });
    const r = await apiGet<GeoResponse>('/api/geo').catch(() => null);
    const p = r?.ok ? r.body.results[0] : undefined;
    if (p) {
      go(p);
      setRegion({ state: 'idle', detail: `${p.name}, ${p.label} (approximate, from your IP)` });
    } else setRegion({ state: 'error', detail: r?.body.detail ?? 'Region lookup failed.' });
  };

  return (
    <div className="flex flex-col gap-3" data-testid="search-panel">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setDebounced.cancel();
          if (text.trim()) setQuery({ q: text.trim(), submit: true });
        }}
        className="flex gap-2"
      >
        <label htmlFor={inputId} className="sr-only">
          Search places or coordinates
        </label>
        <HudInput
          id={inputId}
          autoFocus
          value={text}
          aria-controls={listId}
          placeholder="City, place, or 50.45, 30.52"
          onChange={(e) => {
            setText(e.target.value);
            setDebounced(e.target.value.trim());
          }}
          maxLength={200}
        />
        <HudButton type="submit" aria-label="Search (full geocoder)" title="Search (Enter uses the full geocoder)">
          <Search size={14} aria-hidden />
        </HudButton>
      </form>
      <Prose>Type-ahead uses Photon; press Enter for a full search (Nominatim, queued at 1 request/s). Coordinates like “51.5, -0.12” jump straight there.</Prose>
      {res.data && !res.data.ok && <ErrorLine error={body?.error} detail={body?.detail} />}
      {res.data && <ProviderChips providers={body?.providers} at={res.data.ok ? (body as GeoResponse).timestamp : null} />}
      <ul id={listId} aria-label="Search results" aria-live="polite" className="flex flex-col gap-1">
        {results.map((p, i) => (
          <li key={`${p.source}-${i}-${p.lat}-${p.lng}`}>
            <button
              type="button"
              onClick={() => go(p)}
              className="flex min-h-11 w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--bg-tertiary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold-primary)]"
            >
              {p.source === 'coordinates' ? <Crosshair size={14} className="mt-0.5 shrink-0 text-[var(--cyan-primary)]" aria-hidden /> : <MapPin size={14} className="mt-0.5 shrink-0 text-[var(--gold-primary)]" aria-hidden />}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-sans text-[13px] text-[var(--text-primary)]">{p.name}</span>
                <span className="block truncate font-sans text-[12px] text-[var(--text-secondary)]">{p.label}</span>
              </span>
              <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                {p.kind} · {p.source}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {query && res.data?.ok && !results.length && !res.isFetching && <Prose>No places found{query.submit ? '' : ' — press Enter for a full search'}.</Prose>}
      <div className="border-t border-[var(--border-secondary)] pt-2">
        <HudButton tone="cyan" onClick={centreOnRegion} disabled={region.state === 'busy'} className="w-full">
          <LocateFixed size={14} aria-hidden /> Centre on my region
        </HudButton>
        <Prose className="mt-1">
          One click, one request: your IP address is sent through this server to ipwho.is (or freeipapi.com) to find your approximate region. Nothing is stored.
        </Prose>
        {region.detail && (
          <p role="status" className="mt-1 font-sans text-[12px]" style={{ color: region.state === 'error' ? 'var(--alert-orange)' : 'var(--text-secondary)' }}>
            {region.detail}
          </p>
        )}
      </div>
      {res.data?.ok && <p className="font-sans text-[11px] text-[var(--text-muted)]">{(body as GeoResponse).attribution}</p>}
    </div>
  );
}
