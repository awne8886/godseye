/**
 * ISS position from wheretheiss.at (keyless; 350 requests / 5 min; ACAO *; probed 2026-09-30).
 * The position is OBSERVED-derived (their own tracking), stamped with its `timestamp`; the ground
 * track the route adds is PROPAGATED from NORAD 25544's elements and labelled so.
 * Server-only. Owner: layers-space.
 */
import 'server-only';
import { httpJson } from '@/lib/http';
import { providerBucket } from '@/lib/ratelimit';
import { runProvider, type FeedContext, type FeedData } from '@/lib/feeds';

export const WHERETHEISS_URL = 'https://api.wheretheiss.at/v1/satellites/25544';

export interface IssPosition {
  lat: number;
  lng: number;
  altKm: number;
  velocityKmH: number;
  visibility: 'daylight' | 'eclipsed' | null;
  /** ms epoch of the upstream position timestamp. */
  observedAtMs: number;
}

/** Validate one wheretheiss.at record; null when any coordinate is missing or out of range. */
export function parseWhereTheIss(body: unknown): IssPosition | null {
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
  return { lat, lng, altKm: alt, velocityKmH: vel, visibility, observedAtMs: ts * 1000 };
}

const bucket = () => providerBucket('wheretheiss', 1);

export async function runIss(ctx: FeedContext<IssPosition>): Promise<FeedData<IssPosition>> {
  const r = await runProvider(
    async () => parseWhereTheIss((await httpJson<unknown>(WHERETHEISS_URL, { retries: 1, timeoutMs: 8_000, limiter: bucket(), signal: ctx.signal })).data),
    (d) => (d ? 1 : 0),
  );
  if (!r.result) throw new Error(r.run.status.error ?? 'wheretheiss.at returned no position');
  return { data: r.result, providers: { wheretheiss: r.run }, observedAt: r.result.observedAtMs };
}
