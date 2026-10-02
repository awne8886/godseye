/**
 * Small SVG plots for entity-card TRACK tabs (§7): a ground-track plot and a value-over-time profile
 * (altitude). They draw exactly the points they are given, joined in order; a null value or a new
 * run is a gap, never bridged or smoothed. Colours are tokens. Owner: design-system-hud.
 */
import type { LngLatTuple } from '@/lib/geo';

const W = 300;
const H = 120;
const PAD = 6;

export const hhmmssZ = (ms: number) => `${new Date(ms).toISOString().slice(11, 19)}Z`;

/**
 * Longitudes made continuous along each run (a step never exceeds 180°), so a track over the
 * antimeridian stays one line; values may leave [-180, 180]. Pure.
 */
export function unwrapRuns(runs: readonly (readonly LngLatTuple[])[]): LngLatTuple[][] {
  return runs.map((run) => {
    const out: LngLatTuple[] = [];
    for (const [lng, lat] of run) {
      const prev = out[out.length - 1];
      let x = lng;
      if (prev) while (x - prev[0] > 180) x -= 360;
      if (prev) while (prev[0] - x > 180) x += 360;
      out.push([x, lat]);
    }
    return out;
  });
}

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Plate-carrée box around the points (equal degrees scaled by cos(mid-latitude)) with a margin. */
export function fitBox(points: readonly LngLatTuple[]): Box {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const [x, y] of points) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  const k = Math.max(0.2, Math.cos((((y0 + y1) / 2) * Math.PI) / 180));
  // Expand the short side so the plot keeps the map's aspect (no stretched tracks).
  let w = Math.max((x1 - x0) * k, 0.05);
  let h = Math.max(y1 - y0, 0.05);
  if (w / h > W / H) h = (w * H) / W;
  else w = (h * W) / H;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return { x0: cx - (w / k) * 0.55, x1: cx + (w / k) * 0.55, y0: cy - h * 0.55, y1: cy + h * 0.55 };
}

const WORLD: Box = { x0: -180, x1: 180, y0: -90, y1: 90 };

function project(box: Box, [x, y]: LngLatTuple): [number, number] {
  return [PAD + ((x - box.x0) / (box.x1 - box.x0)) * (W - 2 * PAD), PAD + ((box.y1 - y) / (box.y1 - box.y0)) * (H - 2 * PAD)];
}

const pts = (box: Box, run: readonly LngLatTuple[]) =>
  run
    .map((p) => project(box, p))
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ');

/**
 * Ground track. `world` plots the whole Earth (orbits); otherwise the box fits the track. `head`
 * marks one point (the latest observed position, or the satellite's anchor) when given.
 */
export function GroundTrackPlot({ runs, head, world, label, color = 'var(--gold-primary)' }: { runs: readonly (readonly LngLatTuple[])[]; head?: LngLatTuple | null; world?: boolean; label: string; color?: string }) {
  const drawn = world ? runs.map((r) => [...r]) : unwrapRuns(runs);
  const all = drawn.flat();
  if (all.length === 0) return null;
  const box = world ? WORLD : fitBox(all);
  let h: LngLatTuple | null = head ?? null;
  if (h && !world) {
    // The head on the same continuous longitude as the end of the track.
    const last = all[all.length - 1]!;
    h = unwrapRuns([[last, h]])[0]![1]!;
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="block h-auto w-full rounded-md border border-[var(--border-secondary)] bg-[var(--bg-void)]" data-testid="ground-track-plot">
      {world && (
        <g stroke="var(--border-secondary)" strokeWidth={0.5} fill="none" aria-hidden>
          {[-60, -30, 0, 30, 60].map((lat) => {
            const [, y] = project(WORLD, [0, lat]);
            return <line key={`lat${lat}`} x1={PAD} x2={W - PAD} y1={y} y2={y} strokeDasharray={lat === 0 ? undefined : '2 3'} />;
          })}
          {[-120, -60, 0, 60, 120].map((lng) => {
            const [x] = project(WORLD, [lng, 0]);
            return <line key={`lng${lng}`} x1={x} x2={x} y1={PAD} y2={H - PAD} strokeDasharray={lng === 0 ? undefined : '2 3'} />;
          })}
        </g>
      )}
      {drawn.map((run, i) =>
        run.length > 1 ? <polyline key={i} points={pts(box, run)} fill="none" stroke={color} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" /> : null,
      )}
      {h && (
        <circle cx={project(box, h)[0]} cy={project(box, h)[1]} r={3} fill="var(--cyan-primary)" stroke="var(--bg-void)" strokeWidth={1} data-testid="track-head" />
      )}
    </svg>
  );
}

export interface ProfilePoint {
  /** Epoch ms. */
  t: number;
  /** null = no value at this sample: a gap in the line. */
  v: number | null;
}

/** Contiguous non-null runs of a profile. Pure. */
export function profileRuns(points: readonly ProfilePoint[]): ProfilePoint[][] {
  const runs: ProfilePoint[][] = [];
  let run: ProfilePoint[] = [];
  for (const p of points) {
    if (p.v === null) {
      if (run.length) runs.push(run);
      run = [];
    } else run.push(p);
  }
  if (run.length) runs.push(run);
  return runs;
}

/** A value-over-time profile (e.g. altitude), with its min/max and first/last sample times. */
export function ProfilePlot({ points, label, format, color = 'var(--cyan-primary)' }: { points: readonly ProfilePoint[]; label: string; format: (v: number) => string; color?: string }) {
  const runs = profileRuns(points);
  const values = runs.flat();
  if (values.length === 0) return null;
  const t0 = points[0]!.t;
  const t1 = points[points.length - 1]!.t;
  let lo = Math.min(...values.map((p) => p.v!));
  let hi = Math.max(...values.map((p) => p.v!));
  if (hi === lo) {
    hi += 1;
    lo -= 1;
  }
  const x = (t: number) => PAD + (t1 === t0 ? 0.5 : (t - t0) / (t1 - t0)) * (W - 2 * PAD);
  const y = (v: number) => PAD + ((hi - v) / (hi - lo)) * (H - 2 * PAD);
  return (
    <figure className="flex flex-col gap-1">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: ${format(lo)} to ${format(hi)}, ${hhmmssZ(t0)} to ${hhmmssZ(t1)}`} className="block h-auto w-full rounded-md border border-[var(--border-secondary)] bg-[var(--bg-void)]" data-testid="profile-plot">
        {runs.map((run, i) =>
          run.length > 1 ? (
            <polyline key={i} points={run.map((p) => `${x(p.t).toFixed(1)},${y(p.v!).toFixed(1)}`).join(' ')} fill="none" stroke={color} strokeWidth={1.4} strokeLinejoin="round" />
          ) : (
            <circle key={i} cx={x(run[0]!.t)} cy={y(run[0]!.v!)} r={1.5} fill={color} />
          ),
        )}
      </svg>
      <figcaption className="flex justify-between font-mono text-[10px] uppercase tabular-nums tracking-[0.16em] text-[var(--text-muted)]">
        <span>{hhmmssZ(t0)}</span>
        <span>
          {label} {format(lo)}–{format(hi)}
        </span>
        <span>{hhmmssZ(t1)}</span>
      </figcaption>
    </figure>
  );
}

/** A labelled TRACK-tab value (HUD type, never truncated). */
export function TrackField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{label}</dt>
      <dd className="wrap-anywhere font-mono text-[11px] uppercase tabular-nums tracking-[0.08em] text-[var(--text-primary)]">{value}</dd>
    </div>
  );
}

/** One-line TRACK-tab state (loading, unavailable, none). */
export function TrackNote({ children, tone = 'muted' }: { children: string; tone?: 'muted' | 'warn' }) {
  return (
    <p role="status" className={`font-mono text-[10px] uppercase tracking-[0.16em] ${tone === 'warn' ? 'text-[var(--alert-orange)]' : 'text-[var(--text-muted)]'}`}>
      {children}
    </p>
  );
}
