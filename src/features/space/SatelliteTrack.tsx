'use client';
/**
 * Satellite TRACK tab (`tracks.satellite`, §7): the ground track ±½ orbit from /api/satellites/orbit
 * (the same query the card body uses, so the drawn orbit and this plot agree) and the next pass
 * over the MAP CENTRE (never the visitor's location), predicted client-side with SGP4 from the same
 * catalogue elements (/api/satellites?id=). Everything here is PROPAGATED, not observed, and says so.
 * Owner: layers-space.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { CardProps } from '@/lib/feature-module';
import { useMapInstanceStore } from '@/lib/layer-host';
import type { LngLatTuple } from '@/lib/geo';
import { GroundTrackPlot, TrackField, TrackNote, hhmmssZ } from '@/components/cards/track-plot';
import { recordToOmm } from './lib/catalog';
import { satrecFromOmm } from './lib/orbit';
import { nextPass, type PassResult } from './lib/passes';
import { fetchOrbit, fetchSatelliteById, orbitQueryKey, recordFromResponse, satelliteByIdQueryKey, useSpaceStore, type SatelliteSelectionData } from './client/data';

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export const compass = (az: number) => COMPASS[Math.round((((az % 360) + 360) % 360) / 45) % 8]!;

const MIN_EL = 10;
const dateTime = (ms: number) => `${new Date(ms).toISOString().slice(5, 10)} ${hhmmssZ(ms)}`;

/** The pass block's lines, worded for the HUD. Pure. */
export function passLines(r: PassResult): { label: string; value: string }[] | string {
  switch (r.kind) {
    case 'unpropagatable':
      return 'ELEMENTS CANNOT BE PROPAGATED · NO PASS PREDICTION';
    case 'none':
      return `NO PASS ABOVE ${MIN_EL}° IN THE NEXT 24 H`;
    case 'always-up':
      return `ABOVE ${MIN_EL}° FOR THE WHOLE NEXT 24 H`;
    case 'pass': {
      const p = r.pass;
      return [
        p.aosMs === null || p.aosAzimuthDeg === null
          ? { label: `ABOVE ${MIN_EL}° NOW`, value: 'RISE NOT PREDICTED' }
          : { label: r.inProgress ? 'ROSE (±30 S)' : 'RISES (±30 S)', value: `${dateTime(p.aosMs)} · ${compass(p.aosAzimuthDeg)}` },
        { label: 'MAX ELEVATION', value: `${Math.round(p.maxElevationDeg)}° · ${hhmmssZ(p.maxMs)}` },
        { label: 'SETS (±30 S)', value: p.losMs === null ? 'AFTER 24 H' : hhmmssZ(p.losMs) },
      ];
    }
  }
}

function NextPass({ data }: { data: SatelliteSelectionData }) {
  const map = useMapInstanceStore((s) => s.map);
  const sats = useQuery({ queryKey: satelliteByIdQueryKey(data.noradId), queryFn: () => fetchSatelliteById(data.noradId), staleTime: 5 * 60_000 });
  const [result, setResult] = useState<{ at: { lat: number; lng: number }; r: PassResult } | null>(null);
  const compute = () => {
    const rec = recordFromResponse(sats.data, data.noradId);
    const c = map?.getCenter();
    if (!rec || !c) return;
    const satrec = satrecFromOmm(recordToOmm(rec));
    const at = { lat: c.lat, lng: c.lng };
    setResult({ at, r: satrec ? nextPass(satrec, at, Date.now(), { minElevationDeg: MIN_EL }) : { kind: 'unpropagatable' } });
  };
  const lines = result ? passLines(result.r) : null;
  return (
    <section aria-label="Next pass over the map centre" className="flex flex-col gap-2" data-testid="satellite-next-pass">
      <h3 className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">NEXT PASS ≥ {MIN_EL}° · PREDICTED</h3>
      {sats.isPending ? (
        <TrackNote>LOADING ELEMENTS…</TrackNote>
      ) : sats.isError || !recordFromResponse(sats.data, data.noradId) ? (
        <TrackNote tone="warn">ELEMENTS UNAVAILABLE · NO PASS PREDICTION</TrackNote>
      ) : (
        <>
          {result && (
            <p className="font-mono text-[10px] uppercase tabular-nums tracking-[0.16em] text-[var(--text-secondary)]">
              OVER MAP CENTRE {result.at.lat.toFixed(2)}, {result.at.lng.toFixed(2)}
            </p>
          )}
          {lines && (typeof lines === 'string' ? <TrackNote>{lines}</TrackNote> : <dl className="grid grid-cols-1 gap-y-1">{lines.map((l) => <TrackField key={l.label} {...l} />)}</dl>)}
          <button
            type="button"
            onClick={compute}
            disabled={!map}
            className="flex min-h-8 items-center justify-center rounded-md border border-[var(--cyan-primary)]/40 bg-[var(--cyan-primary)]/10 px-3 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--cyan-primary)] hover:bg-[var(--cyan-primary)]/20 focus-visible:outline-2 focus-visible:outline-[var(--gold-primary)] disabled:opacity-50 phone:min-h-11"
          >
            {result ? 'RECOMPUTE FOR MAP CENTRE' : 'PREDICT PASS OVER MAP CENTRE'}
          </button>
          <p className="text-[12px] text-[var(--text-secondary)]">Pan the map to the place you care about first. Your own location is never used.</p>
        </>
      )}
    </section>
  );
}

export function SatelliteTrack({ selection }: CardProps) {
  const data = selection.data as SatelliteSelectionData;
  const telemetry = useSpaceStore((s) => (s.telemetry?.noradId === data.noradId ? s.telemetry : null));
  const orbit = useQuery({
    queryKey: orbitQueryKey(data.noradId, data.anchorAt),
    queryFn: () => fetchOrbit(data.noradId, data.anchorAt),
    staleTime: 10 * 60_000,
    retry: 1,
  });
  if (selection.kind !== 'satellite') return null;
  const runs: LngLatTuple[][] = orbit.data ? orbit.data.segments.map((seg) => seg.map(([lng, lat]) => [lng, lat] as LngLatTuple)) : [];
  const alts = orbit.data ? orbit.data.segments.flat().map((p) => p[2]) : [];
  return (
    <div className="flex flex-col gap-3" data-testid="satellite-track">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-secondary)]">
        <span className="mr-2 rounded-sm border border-[var(--cyan-dim)] px-1.5 py-0.5 text-[var(--cyan-primary)]">PROPAGATED</span>
        GROUND TRACK ±½ ORBIT
      </p>
      {orbit.isPending ? (
        <TrackNote>PLOTTING GROUND TRACK…</TrackNote>
      ) : orbit.isError || runs.length === 0 ? (
        <TrackNote tone="warn">NO GROUND TRACK · ELEMENTS UNAVAILABLE</TrackNote>
      ) : (
        <>
          <GroundTrackPlot world runs={runs} head={telemetry ? [telemetry.lng, telemetry.lat] : null} label={`Propagated ground track of ${data.name} over one orbit, anchored ${orbit.data.anchoredAt}`} color="var(--gold-primary)" />
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
            <TrackField label="ANCHORED" value={dateTime(Date.parse(orbit.data.anchoredAt))} />
            <TrackField label="PERIOD" value={`${orbit.data.periodMinutes.toFixed(1)} MIN`} />
            <TrackField label="ALT RANGE" value={`${Math.round(Math.min(...alts)).toLocaleString('en-US')}–${Math.round(Math.max(...alts)).toLocaleString('en-US')} KM`} />
            <TrackField label="ELEMENTS" value={orbit.data.elementsEpoch ? dateTime(Date.parse(orbit.data.elementsEpoch)) : '—'} />
          </dl>
        </>
      )}
      <NextPass data={data} />
    </div>
  );
}
