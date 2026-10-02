'use client';
/**
 * Vessel TRACK tab (`tracks.vessel`, §7): the recent AIS positions the relay received for this
 * vessel (`track`, ≤ 20 `[lng, lat, epochS]`, as carried by the selection), with each position's
 * own time and the speed between consecutive reports. Observed reports only; nothing interpolated.
 */
import type { CardProps } from '@/lib/feature-module';
import type { LngLatTuple } from '@/lib/geo';
import { GroundTrackPlot, TrackField, TrackNote, hhmmssZ } from '@/components/cards/track-plot';
import { formatAge } from '@/lib/freshness';
import { segmentKnots } from './MaritimeLayer';

type AisPoint = [number, number, number];

export default function VesselTrack({ selection }: CardProps) {
  const raw = (selection.data as { track?: unknown }).track;
  const track: AisPoint[] = Array.isArray(raw) ? raw.filter((p): p is AisPoint => Array.isArray(p) && p.length === 3 && p.every((n) => typeof n === 'number' && Number.isFinite(n))) : [];
  if (track.length === 0) return <TrackNote>NO AIS TRACK RECEIVED FOR THIS VESSEL YET</TrackNote>;
  const line: LngLatTuple[] = track.map(([lng, lat]) => [lng, lat]);
  const first = track[0]![2] * 1000;
  const last = track[track.length - 1]!;
  const rows = track.map((p, i) => ({ p, kn: i > 0 ? segmentKnots(track[i - 1]!, p) : null })).reverse();
  return (
    <div className="flex flex-col gap-3" data-testid="vessel-track">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-secondary)]">OBSERVED · AIS · {track.length} POSITIONS AT SELECTION</p>
      <GroundTrackPlot runs={[line]} head={[last[0], last[1]]} label={`Observed AIS track, ${track.length} positions from ${hhmmssZ(first)} to ${hhmmssZ(last[2] * 1000)}`} />
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
        <TrackField label="FIRST" value={hhmmssZ(first)} />
        <TrackField label="LATEST" value={hhmmssZ(last[2] * 1000)} />
        <TrackField label="SPAN" value={formatAge(last[2] * 1000 - first)} />
        <TrackField label="REPORTS" value={String(track.length)} />
      </dl>
      <table className="w-full font-mono text-[11px] uppercase tabular-nums tracking-[0.08em] text-[var(--text-primary)]">
        <caption className="text-left font-mono text-[10px] tracking-[0.16em] text-[var(--text-muted)]">RECEIVED POSITIONS · SPEED SINCE PREVIOUS</caption>
        <thead className="sr-only">
          <tr>
            <th>Time</th>
            <th>Position</th>
            <th>Speed since previous report</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ p, kn }) => (
            <tr key={p[2]}>
              <td className="pr-2 text-[var(--text-secondary)]">{hhmmssZ(p[2] * 1000)}</td>
              <td className="pr-2">
                {p[1].toFixed(3)}, {p[0].toFixed(3)}
              </td>
              <td className="text-right">{kn === null ? '—' : `${kn.toFixed(1)} KT`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[12px] text-[var(--text-secondary)]">AIS reports relayed from AISStream. The line joins received reports; nothing between them is estimated.</p>
    </div>
  );
}
