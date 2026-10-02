'use client';
/**
 * Aircraft TRACK tab (`tracks.aircraft`, §7): the observed flown track of the current leg and its
 * altitude profile, from the adsb.lol readsb trace /api/aircraft already serves (the same query the
 * card body and the watched trail use; no extra upstream). Only observed samples with their own
 * times are shown: no dead-reckoned head, nothing interpolated between samples.
 */
import type { CardProps } from '@/lib/feature-module';
import { distanceKm, kmToNm, type LngLatTuple } from '@/lib/geo';
import { formatAge } from '@/lib/freshness';
import { GroundTrackPlot, ProfilePlot, TrackField, TrackNote, hhmmssZ } from '@/components/cards/track-plot';
import type { TrackPoint } from '../trace';
import { useAircraftDetail } from './AircraftCard';
import { formatAlt, formatKt, traceSourceLabel } from './format';

export interface TrackSummary {
  points: number;
  firstMs: number;
  lastMs: number;
  /** Sum of great-circle steps between consecutive observed samples (km). */
  distanceKm: number;
  maxAltFt: number | null;
}

/** Figures over the observed samples only. Null for an empty track. Pure. */
export function summariseTrack(track: readonly TrackPoint[]): TrackSummary | null {
  if (track.length === 0) return null;
  let km = 0;
  let maxAlt: number | null = null;
  for (let i = 0; i < track.length; i++) {
    const p = track[i]!;
    if (p.altFt !== null) maxAlt = maxAlt === null ? p.altFt : Math.max(maxAlt, p.altFt);
    if (i > 0) km += distanceKm([track[i - 1]!.lng, track[i - 1]!.lat], [p.lng, p.lat]);
  }
  return { points: track.length, firstMs: Date.parse(track[0]!.t), lastMs: Date.parse(track[track.length - 1]!.t), distanceKm: km, maxAltFt: maxAlt };
}

/** Ground samples read 0 ft (observed on the ground); an airborne sample without altitude is a gap. */
export const profileOf = (track: readonly TrackPoint[]) => track.map((p) => ({ t: Date.parse(p.t), v: p.onGround ? 0 : p.altFt }));

const ft = (v: number) => `${Math.round(v).toLocaleString('en-US')} FT`;

export default function AircraftTrack({ selection }: CardProps) {
  const hex = /^[0-9a-f]{6}$/.test(selection.id) ? selection.id : null;
  const detail = useAircraftDetail(hex);
  if (!hex) return <TrackNote>NO TRACE · NON-ICAO ADDRESS (TIS-B / ANONYMISED)</TrackNote>;
  if (detail.isPending) return <TrackNote>LOADING OBSERVED TRACK…</TrackNote>;
  if (detail.isError || !detail.data) return <TrackNote tone="warn">TRACE SOURCE OFFLINE · NO TRACK SHOWN</TrackNote>;
  const track = detail.data.track;
  const traceRun = detail.data.providers?.adsblol_trace;
  const summary = summariseTrack(track);
  if (!summary) return <TrackNote tone={traceRun && !traceRun.ok ? 'warn' : 'muted'}>{traceRun && !traceRun.ok ? 'TRACE SOURCE FAILED · NO TRACK SHOWN' : 'NO OBSERVED TRACK FOR THE CURRENT LEG'}</TrackNote>;
  const line: LngLatTuple[] = track.map((p) => [p.lng, p.lat]);
  const last = track[track.length - 1]!;
  const recent = track.slice(-5).reverse();
  const source = traceSourceLabel(detail.data.trackSource);

  return (
    <div className="flex flex-col gap-3" data-testid="aircraft-track">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-secondary)]">
        OBSERVED · CURRENT LEG · {summary.points.toLocaleString('en-US')} POSITIONS
      </p>
      <GroundTrackPlot runs={[line]} head={[last.lng, last.lat]} label={`Observed ground track, ${summary.points} positions from ${hhmmssZ(summary.firstMs)} to ${hhmmssZ(summary.lastMs)}`} />
      <ProfilePlot points={profileOf(track)} label="ALT" format={ft} />
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
        <TrackField label="FIRST" value={hhmmssZ(summary.firstMs)} />
        <TrackField label="LATEST" value={hhmmssZ(summary.lastMs)} />
        <TrackField label="SPAN" value={formatAge(summary.lastMs - summary.firstMs)} />
        <TrackField label="DIST (SAMPLES)" value={`${Math.round(kmToNm(summary.distanceKm)).toLocaleString('en-US')} NM`} />
        <TrackField label="MAX ALT" value={summary.maxAltFt === null ? '—' : ft(summary.maxAltFt)} />
        <TrackField label="POSITION" value={source ?? '—'} />
      </dl>
      <section aria-label="Latest observed positions">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">LATEST OBSERVED POSITIONS</h3>
        <table className="mt-1 w-full font-mono text-[11px] uppercase tabular-nums tracking-[0.08em] text-[var(--text-primary)]">
          <thead className="sr-only">
            <tr>
              <th>Time</th>
              <th>Position</th>
              <th>Altitude</th>
              <th>Ground speed</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((p) => (
              <tr key={p.t}>
                <td className="pr-2 text-[var(--text-secondary)]">{p.t.slice(11, 19)}Z</td>
                <td className="pr-2">
                  {p.lat.toFixed(3)}, {p.lng.toFixed(3)}
                </td>
                <td className="pr-2 text-right">{formatAlt(p)}</td>
                <td className="text-right">{formatKt(p.gsKt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="text-[12px] text-[var(--text-secondary)]">Observed samples from the adsb.lol readsb trace (© adsb.lol contributors, ODbL 1.0), downsampled to ≤ 700 points. The line joins observed samples; nothing between them is estimated.</p>
    </div>
  );
}
