/**
 * FlightPlanDatabase (api.flightplandatabase.com) sim-community plans, only with the `fpdb`
 * capability (FPDB_API_KEY, HTTP Basic with the key as username). Terms: flight simulation use
 * only, attribution required — every plan carries that disclaimer. The anonymous search answered
 * 502 when probed (2026-09-30), so failures are normal and shown in `providers`. Cached 24 h per
 * pair (the keyed daily cap is small). Server-only.
 */
import 'server-only';
import { sourceCache } from '@/lib/cache';
import { hasCapability } from '@/lib/capabilities';
import { runProvider, skippedProvider, type ProviderRun } from '@/lib/feeds';
import { httpJson } from '@/lib/http';
import { providerBucket } from '@/lib/ratelimit';

export const FPDB_DISCLAIMER = 'Sim-community plan from FlightPlanDatabase — for flight simulation only, not for real-world navigation.';

export interface FiledPlan {
  id: string;
  waypoints: { ident: string; type: string; lat: number; lng: number; altFt: number | null; via: string | null }[];
  distanceNm: number | null;
  source: string;
  disclaimer: string;
}

interface FpdbNode {
  type?: string;
  ident?: string;
  lat?: number;
  lon?: number;
  alt?: number | null;
  via?: { ident?: string } | null;
}

interface FpdbPlan {
  id?: number;
  distance?: number;
  route?: { nodes?: FpdbNode[] };
}

export function mapFpdbPlans(plans: readonly FpdbPlan[]): FiledPlan[] {
  const out: FiledPlan[] = [];
  for (const p of plans) {
    const nodes = (p.route?.nodes ?? []).filter((n) => typeof n.lat === 'number' && typeof n.lon === 'number' && Math.abs(n.lat) <= 90 && Math.abs(n.lon) <= 180);
    if (p.id === undefined || nodes.length < 2) continue;
    out.push({
      id: `fpdb:${p.id}`,
      waypoints: nodes.map((n) => ({
        ident: String(n.ident ?? '').slice(0, 12) || 'WPT',
        type: String(n.type ?? 'UKN').slice(0, 8),
        lat: n.lat!,
        lng: n.lon!,
        altFt: typeof n.alt === 'number' ? n.alt : null,
        via: n.via?.ident ? String(n.via.ident).slice(0, 12) : null,
      })),
      distanceNm: typeof p.distance === 'number' ? Math.round(p.distance) : null,
      source: 'FlightPlanDatabase',
      disclaimer: FPDB_DISCLAIMER,
    });
  }
  return out;
}

export async function filedPlans(from: string, to: string, env: Record<string, string | undefined> = process.env): Promise<{ plans: FiledPlan[]; run: ProviderRun }> {
  if (!hasCapability('fpdb', env)) return { plans: [], run: skippedProvider('not-configured') };
  const key = env.FPDB_API_KEY ?? '';
  const cache = sourceCache<{ plans: FiledPlan[]; run: ProviderRun }>(
    `fp:fpdb:${from}-${to}`,
    async () => {
      const url = `https://api.flightplandatabase.com/search/plans?fromICAO=${from}&toICAO=${to}&sort=popularity&limit=2&includeRoute=true`;
      const r = await runProvider(
        async () =>
          mapFpdbPlans(
            (await httpJson<FpdbPlan[]>(url, { timeoutMs: 10_000, retries: 0, limiter: providerBucket('api.flightplandatabase.com', 0.2, 1), headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}` } })).data ?? [],
          ),
        (p) => p.length,
        { allowEmpty: true },
      );
      if (!r.run.status.ok) throw new Error(r.run.status.error ?? 'fpdb_failed');
      return { data: { plans: r.result ?? [], run: r.run } };
    },
    { ttlMs: 24 * 3_600_000, retryAfterErrorMs: 10 * 60_000, deadlineMs: 15_000, isEmpty: () => false },
  );
  const r = await cache.get();
  if (!r.data) return { plans: [], run: { status: { ok: false, count: 0, ms: 0, age_s: null, error: r.error ?? 'error' }, okAt: null } };
  return r.data;
}
