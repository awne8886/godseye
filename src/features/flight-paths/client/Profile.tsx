'use client';
/**
 * Altitude / ground-speed profile of the flown track (adsb.lol trace, observed), with a dashed
 * modelled "typical" profile for comparison on the same time axis (climb at 2,000 ft/min to FL350,
 * then cruise). The model is labelled as such in the caption. Client-only.
 */
import type { Flight } from './api';

const W = 320;
const H = 110;
const MAX_FT = 45_000;
const MAX_KT = 600;
export const TYPICAL_CRUISE_FT = 35_000;
export const CLIMB_FPM = 2_000;

export interface ProfilePoint {
  tMin: number;
  altFt: number | null;
  gsKt: number | null;
}

/** Minutes since the first point; ground rows count as 0 ft. */
export function profilePoints(track: Flight['flownTrack']): ProfilePoint[] {
  if (!track.length) return [];
  const t0 = Date.parse(track[0]!.t);
  return track.map((p) => ({ tMin: (Date.parse(p.t) - t0) / 60_000, altFt: p.onGround ? 0 : p.altFt, gsKt: p.gsKt }));
}

/** Typical profile over the same time axis: climb 2,000 ft/min to FL350, then cruise. */
export function typicalClimb(spanMin: number): [number, number][] {
  const climbMin = TYPICAL_CRUISE_FT / CLIMB_FPM;
  return spanMin <= climbMin
    ? [
        [0, 0],
        [spanMin, spanMin * CLIMB_FPM],
      ]
    : [
        [0, 0],
        [climbMin, TYPICAL_CRUISE_FT],
        [spanMin, TYPICAL_CRUISE_FT],
      ];
}

export function Profile({ track }: { track: Flight['flownTrack'] }) {
  const pts = profilePoints(track);
  if (pts.length < 2) return null;
  const span = Math.max(1, pts[pts.length - 1]!.tMin);
  const x = (t: number) => ((t / span) * W).toFixed(1);
  const yAlt = (a: number) => (H - (Math.min(a, MAX_FT) / MAX_FT) * H).toFixed(1);
  const yGs = (g: number) => (H - (Math.min(g, MAX_KT) / MAX_KT) * H).toFixed(1);
  const alt = pts.filter((p) => p.altFt !== null).map((p) => `${x(p.tMin)},${yAlt(p.altFt!)}`).join(' ');
  const gs = pts.filter((p) => p.gsKt !== null).map((p) => `${x(p.tMin)},${yGs(p.gsKt!)}`).join(' ');
  const typical = typicalClimb(span).map(([t, a]) => `${x(t)},${yAlt(a)}`).join(' ');
  return (
    <figure className="flex flex-col gap-1">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Altitude and ground-speed profile of the flown track" className="w-full rounded-md border border-[var(--border-secondary)] bg-[var(--bg-void)]">
        {[10_000, 20_000, 30_000, 40_000].map((a) => (
          <line key={a} x1={0} x2={W} y1={yAlt(a)} y2={yAlt(a)} stroke="var(--border-secondary)" strokeWidth={0.5} />
        ))}
        <polyline points={typical} fill="none" stroke="var(--text-muted)" strokeWidth={1} strokeDasharray="3 3" />
        {gs && <polyline points={gs} fill="none" stroke="var(--cyan-primary)" strokeWidth={1} strokeOpacity={0.7} />}
        {alt && <polyline points={alt} fill="none" stroke="var(--gold-primary)" strokeWidth={1.5} />}
      </svg>
      <figcaption className="font-sans text-[12px] text-[var(--text-secondary)]">
        Gold: observed altitude (0–45,000 ft). Cyan: ground speed (0–600 kt). Dashed: typical-profile model (2,000 ft/min climb to FL350), not data. {Math.round(span)} min of track.
      </figcaption>
    </figure>
  );
}
