/**
 * ISS position from wheretheiss.at (keyless; 350 requests / 5 min; ACAO *; probed 2026-10-02).
 * The position is COMPUTED, not observed: wheretheiss.at propagates NORAD 25544's published TLE
 * (SGP4) to its `timestamp`. The element set it used comes from `/v1/satellites/25544/tles`, so the
 * response names its epoch (`position.elementsEpoch`). The ground track the route adds is
 * propagated from the catalogue's own elements and labelled the same way.
 * Server-only. Owner: layers-space.
 */
import 'server-only';
import { httpJson } from '@/lib/http';
import { providerBucket } from '@/lib/ratelimit';
import { runProvider, type FeedContext, type FeedData, type ProviderRun } from '@/lib/feeds';

export const WHERETHEISS_URL = 'https://api.wheretheiss.at/v1/satellites/25544';
export const WHERETHEISS_TLES_URL = 'https://api.wheretheiss.at/v1/satellites/25544/tles';
/** The ISS element set changes a few times a day: re-read the one wheretheiss.at uses hourly. */
export const ELEMENTS_RECHECK_MS = 60 * 60_000;

export interface IssPosition {
  lat: number;
  lng: number;
  altKm: number;
  velocityKmH: number;
  visibility: 'daylight' | 'eclipsed' | null;
  /**
   * ms epoch the position was computed for (upstream `timestamp`), clamped to the time this server
   * received it: a computation stamped in our future is never "newer than fetched".
   */
  observedAtMs: number;
  /** Epoch (ms) of the TLE wheretheiss.at propagated; null while `/tles` has never answered. */
  elementsEpochMs: number | null;
  /** When `/tles` last answered (ms), for the hourly re-check and its provider age. */
  elementsFetchedAtMs: number | null;
}

/** Validate one wheretheiss.at record; null when any coordinate is missing or out of range. */
export function parseWhereTheIss(body: unknown, receivedAtMs = Date.now()): IssPosition | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const num = (k: string) => (typeof b[k] === 'number' && Number.isFinite(b[k]) ? (b[k] as number) : null);
  const lat = num('latitude');
  const lng = num('longitude');
  const alt = num('altitude');
  const vel = num('velocity');
  const ts = num('timestamp');
  if (lat === null || lng === null || alt === null || vel === null || ts === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180 || alt < 100 || alt > 1000 || ts <= 0) return null;
  if (b.units !== undefined && b.units !== 'kilometers') return null;
  const visibility = b.visibility === 'daylight' || b.visibility === 'eclipsed' ? b.visibility : null;
  return {
    lat,
    lng,
    altKm: alt,
    velocityKmH: vel,
    visibility,
    observedAtMs: Math.min(ts * 1000, receivedAtMs),
    elementsEpochMs: null,
    elementsFetchedAtMs: null,
  };
}

/**
 * Epoch (ms) of the element set from `/tles`: TLE line 1 columns 19–32 (YYDDD.DDDDDDDD, UTC) is
 * authoritative; `tle_timestamp` (unix s, the same epoch rounded) only when line 1 is absent or
 * malformed. Null when neither is usable or the set is not NORAD 25544.
 */
export function parseTleEpoch(body: unknown): number | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (b.id !== undefined && String(b.id) !== '25544') return null;
  const line1 = typeof b.line1 === 'string' ? b.line1 : '';
  const m = /^1 25544U .{8} (\d{2})(\d{3}\.\d+)/.exec(line1);
  if (m) {
    const yy = Number(m[1]);
    const day = Number(m[2]);
    if (day >= 1 && day < 367) return Date.UTC(yy < 57 ? 2000 + yy : 1900 + yy, 0, 1) + Math.round((day - 1) * 86_400_000);
  }
  const ts = b.tle_timestamp;
  return typeof ts === 'number' && Number.isFinite(ts) && ts > 0 ? ts * 1000 : null;
}

const bucket = () => providerBucket('wheretheiss', 1);

export async function runIss(ctx: FeedContext<IssPosition>): Promise<FeedData<IssPosition>> {
  const prev = ctx.previous;
  const reuse = prev !== null && prev.elementsEpochMs !== null && prev.elementsFetchedAtMs !== null && Date.now() - prev.elementsFetchedAtMs < ELEMENTS_RECHECK_MS;
  const [pos, tle] = await Promise.all([
    runProvider(
      async () => {
        const res = await httpJson<unknown>(WHERETHEISS_URL, { retries: 1, timeoutMs: 8_000, limiter: bucket(), signal: ctx.signal });
        return parseWhereTheIss(res.data, Date.now());
      },
      (d) => (d ? 1 : 0),
    ),
    reuse
      ? Promise.resolve(null)
      : runProvider(
          async () => parseTleEpoch((await httpJson<unknown>(WHERETHEISS_TLES_URL, { retries: 1, timeoutMs: 8_000, limiter: bucket(), signal: ctx.signal })).data),
          (e) => (e !== null ? 1 : 0),
        ),
  ]);
  if (!pos.result) throw new Error(pos.run.status.error ?? 'wheretheiss.at returned no position');
  let elementsEpochMs = prev?.elementsEpochMs ?? null;
  let elementsFetchedAtMs = prev?.elementsFetchedAtMs ?? null;
  let elementsRun: ProviderRun;
  if (tle === null) {
    // Re-used within the hour: the provider reports the age of the answer it gave.
    elementsRun = { status: { ok: true, count: 1, ms: 0, age_s: 0 }, okAt: elementsFetchedAtMs };
  } else {
    elementsRun = tle.run;
    // On failure the last epoch `/tles` gave stays (still the newest known); none is ever invented.
    if (tle.result !== null) {
      elementsEpochMs = tle.result;
      elementsFetchedAtMs = Date.now();
    }
  }
  return {
    data: { ...pos.result, elementsEpochMs, elementsFetchedAtMs },
    providers: { wheretheiss: pos.run, 'wheretheiss-tles': elementsRun },
    observedAt: pos.result.observedAtMs,
  };
}
