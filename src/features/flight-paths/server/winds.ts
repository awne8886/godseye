/**
 * Winds aloft (250 hPa ≈ FL340) along a route from Open-Meteo's free tier (CC BY 4.0 data,
 * non-commercial use), only when the `openmeteo` capability is on (off when
 * COMMERCIAL_DEPLOYMENT=true → `skipped: 'licence'`). Samples snap to a 2° grid; grid cells are
 * cached 1 h and every uncached cell of a route goes out in ONE multi-coordinate request. A
 * process-wide hourly request budget protects the shared free tier (`skipped: 'budget'`).
 * Values are the model forecast for the current hour, labelled as such in the UI. Server-only.
 */
import 'server-only';
import { hasCapability } from '@/lib/capabilities';
import { runProvider, skippedProvider, type ProviderRun } from '@/lib/feeds';
import { httpJson } from '@/lib/http';
import { providerBucket } from '@/lib/ratelimit';
import type { LngLatTuple } from '@/lib/geo';

export const GRID_DEG = 2;
export const CELL_TTL_MS = 3_600_000;
export const HOURLY_BUDGET = 120;
const openMeteoBucket = () => providerBucket('api.open-meteo.com', 2, 2);

export interface WindSample {
  fraction: number;
  lat: number;
  lng: number;
  speedKt: number | null;
  dirDeg: number | null;
  level: '250hPa';
}

interface Cell {
  speedKt: number | null;
  dirDeg: number | null;
  at: number;
}

interface OpenMeteoPoint {
  latitude?: number;
  longitude?: number;
  hourly?: { wind_speed_250hPa?: (number | null)[]; wind_direction_250hPa?: (number | null)[] };
}

const G = globalThis as unknown as { __godseyeWinds?: { cells: Map<string, Cell>; window: { start: number; used: number } } };
const state = (G.__godseyeWinds ??= { cells: new Map(), window: { start: 0, used: 0 } });

export function resetWinds(): void {
  state.cells.clear();
  state.window = { start: 0, used: 0 };
}

export const snap = (v: number) => Math.round(v / GRID_DEG) * GRID_DEG;
const cellKey = (lat: number, lng: number) => `${snap(lat)},${snap(lng) === 180 ? -180 : snap(lng)}`;

export function openMeteoUrl(cells: readonly [number, number][]): string {
  const lat = cells.map(([la]) => la.toFixed(2)).join(',');
  const lng = cells.map(([, lo]) => lo.toFixed(2)).join(',');
  return `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=wind_speed_250hPa,wind_direction_250hPa&forecast_hours=1&wind_speed_unit=kn&timezone=GMT`;
}

export type WindsFetcher = (cells: readonly [number, number][]) => Promise<OpenMeteoPoint[]>;

const defaultFetch: WindsFetcher = async (cells) => {
  const res = await httpJson<OpenMeteoPoint | OpenMeteoPoint[] | { error?: boolean; reason?: string }>(openMeteoUrl(cells), { timeoutMs: 10_000, retries: 0, limiter: openMeteoBucket() });
  const d = res.data;
  if (d && !Array.isArray(d) && 'error' in d && d.error) throw new Error(`open-meteo: ${String(d.reason ?? 'error')}`);
  // One coordinate → a single object; several → an array in request order.
  return Array.isArray(d) ? d : d ? [d as OpenMeteoPoint] : [];
};

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export async function windsAloft(
  samples: readonly { fraction: number; point: LngLatTuple }[],
  opts: { fetcher?: WindsFetcher; env?: Record<string, string | undefined>; now?: number } = {},
): Promise<{ winds: WindSample[]; run: ProviderRun }> {
  const now = opts.now ?? Date.now();
  if (!hasCapability('openmeteo', opts.env ?? process.env)) return { winds: [], run: skippedProvider('licence') };
  const pending = new Map<string, [number, number]>();
  for (const s of samples) {
    const k = cellKey(s.point[1], s.point[0]);
    const c = state.cells.get(k);
    if (!c || now - c.at > CELL_TTL_MS) pending.set(k, [snap(s.point[1]), snap(s.point[0]) === 180 ? -180 : snap(s.point[0])]);
  }
  let run: ProviderRun = { status: { ok: true, count: samples.length, ms: 0, age_s: 0 }, okAt: now };
  if (pending.size) {
    if (now - state.window.start > 3_600_000) state.window = { start: now, used: 0 };
    if (state.window.used >= HOURLY_BUDGET) return { winds: [], run: skippedProvider('budget') };
    state.window.used++;
    const keys = [...pending.keys()];
    const cells = [...pending.values()];
    const r = await runProvider(() => (opts.fetcher ?? defaultFetch)(cells), (pts) => pts.length);
    run = r.run;
    if (!r.result || r.result.length !== cells.length) {
      if (r.result) run = { status: { ...run.status, ok: false, count: 0, error: 'parse' }, okAt: null };
      return { winds: [], run };
    }
    r.result.forEach((p, i) => state.cells.set(keys[i]!, { speedKt: num(p.hourly?.wind_speed_250hPa?.[0]), dirDeg: num(p.hourly?.wind_direction_250hPa?.[0]), at: now }));
  }
  const winds = samples.map((s) => {
    const c = state.cells.get(cellKey(s.point[1], s.point[0]));
    return { fraction: s.fraction, lat: Math.round(s.point[1] * 1e4) / 1e4, lng: Math.round(s.point[0] * 1e4) / 1e4, speedKt: c?.speedKt ?? null, dirDeg: c?.dirDeg ?? null, level: '250hPa' as const };
  });
  return { winds, run: { ...run, status: { ...run.status, count: winds.filter((w) => w.speedKt !== null).length } } };
}
