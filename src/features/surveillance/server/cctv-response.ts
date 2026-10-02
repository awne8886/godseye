/**
 * Builds the columnar `/api/cctv` response for a set of regions: waits up to 12 s for regions with
 * no data yet (2 s once any region has data, OSIRIS's WARM_GRACE), lists the rest in
 * `pendingRegions` for the client to retry, merges meta/providers, and serves the payload
 * pre-serialised and precompressed with a weak ETag (304 on If-None-Match), rebuilt at least once a
 * minute so `providers.*.age_s` is the inventory's real age (`cctvVersion`). A region whose every
 * provider needs a key this instance lacks is "not configured": it is never fetched, it is listed
 * in `disabledRegions` and its providers report `skipped: 'not-configured'` (or `'licence'` for a
 * licence gate; 200, no rows). 503
 * SOURCE OFFLINE only when configured providers were asked and none of them answered.
 * Every region result is read through gateRegion() with this request's environment, so rows,
 * `providers` and `meta.attribution` of a provider that is off on this instance never reach the
 * response, whatever the SnapshotStore kept from an earlier configuration (round 8).
 * Owner: layers-surveillance. Server-only.
 */
import 'server-only';
import { hasCapability } from '@/lib/capabilities';
import { skippedProvider, type FeedResult } from '@/lib/feeds';
import { compressedJson, json } from '@/lib/respond';
import { CAMERA_FIELDS } from '@/lib/schemas/surveillance';
import type { Attribution, Camera, FeedMeta, FreshnessState, Providers } from '@/lib/types';
import type { CctvRegion } from '../shared';
import { gateRegion, gateSignature, INVENTORY_TTL_MS, regionFeed } from './catalog';
import { publicCamera } from './frames';
import { providerDef, providerRow, providersIn, regionDisabled, skipReasonOf } from './registry';

export const COLD_BUDGET_MS = 12_000;
export const WARM_GRACE_MS = 2_000;
/** Edge TTL for a complete answer (inventory changes every 30 min at most). */
export const CCTV_EDGE_TTL_S = 300;

const STATE_RANK: Record<FreshnessState, number> = { live: 0, reference: 0, recent: 1, stale: 2, offline: 3 };

function withBudget<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms).unref?.())]);
}

export async function collectRegions(
  regions: readonly CctvRegion[],
  budgets = { cold: COLD_BUDGET_MS, warm: WARM_GRACE_MS },
  env: Record<string, string | undefined> = process.env,
) {
  const feeds = regions.map((r) => ({ region: r, feed: regionFeed(r) }));
  const anyWarm = feeds.some(({ feed }) => feed.peek().data !== null);
  const budget = anyWarm ? budgets.warm : budgets.cold;
  const results = await Promise.all(
    feeds.map(async ({ region, feed }) => {
      const peek = feed.peek();
      // Warm regions answer from cache (a stale one refreshes in the background inside get()).
      const res = peek.data !== null ? await feed.get() : await withBudget(feed.get(), budget);
      return { region, res: gateRegion(res ?? feed.peek(), providersIn(region), env), pending: res === null };
    }),
  );
  return results;
}

export function mergeMeta(results: { region: CctvRegion; res: FeedResult<Camera[]> }[]): { meta: FeedMeta; providers: Providers } {
  const served = results.filter((r) => r.res.data !== null);
  const pick = served.length ? served : results;
  const worst = pick.reduce<FreshnessState>((w, r) => (STATE_RANK[r.res.meta.state] > STATE_RANK[w] ? r.res.meta.state : w), 'live');
  const times = (k: 'fetchedAt' | 'lastGoodAt') => pick.map((r) => r.res.meta[k]).filter((t): t is string => t !== null).sort();
  const observed = pick.map((r) => r.res.meta.observedAt).filter((t): t is string => t !== null).sort();
  const attribution: Attribution[] = [];
  const seen = new Set<string>();
  for (const r of pick) for (const a of r.res.meta.attribution) {
    if (seen.has(a.text)) continue;
    seen.add(a.text);
    attribution.push(a);
  }
  const providers: Providers = {};
  for (const r of results) Object.assign(providers, r.res.providers);
  return {
    meta: {
      feed: 'cctv',
      kind: 'live',
      state: served.length ? worst : 'offline',
      fetchedAt: times('fetchedAt')[0] ?? null,
      observedAt: observed.at(-1) ?? null,
      lastGoodAt: times('lastGoodAt')[0] ?? null,
      stale: pick.some((r) => r.res.meta.stale),
      ttlSeconds: Math.round(INVENTORY_TTL_MS / 1000),
      attribution,
      note: 'Camera inventory refreshed every 30 min; frames load on demand through the stills proxy and are never stored.',
    },
    providers,
  };
}

/** Rows in CAMERA_FIELDS order; link-out-only providers publish no frame/stream URLs. */
export function toRows(cameras: readonly Camera[], env: Record<string, string | undefined> = process.env) {
  const rows = new Map<string, ReturnType<typeof providerRow>>();
  return cameras.map((c) => {
    let row = rows.get(c.providerId);
    if (!row) {
      const def = providerDef(c.providerId);
      row = def ? providerRow(def, env) : undefined;
      if (row) rows.set(c.providerId, row);
    }
    const pub = row ? publicCamera(c, row) : c;
    return CAMERA_FIELDS.map((f) => (pub as Record<string, unknown>)[f] ?? null) as (string | number | null)[];
  });
}

/** `providers.*.age_s` (and the freshness state) are re-derived at least this often. */
export const AGE_BUCKET_MS = 60_000;

/**
 * Cache version of a /api/cctv payload. The payload is serialised and compressed once per version,
 * so the version carries a minute bucket: without it `providers.*.age_s` stayed at the value of the
 * first request (0–3 s) for the whole 30-min inventory TTL (R2 MINOR-2, rounds 3–4). `config` is
 * the instance configuration that shapes the rows (link-out regions, capability gates, removed
 * ids): a payload built under another configuration is never served from the compressed cache.
 */
export function cctvVersion(
  served: readonly { region: string; fetchedAt: string | null; state: string }[],
  pendingRegions: readonly string[],
  disabledRegions: readonly string[],
  config: string,
  now: number = Date.now(),
): string {
  return [...served.map((r) => `${r.region}@${r.fetchedAt}:${r.state}`), `pending=${pendingRegions.join('+')}`, `off=${disabledRegions.join('+')}`, `cfg=${config}`, `age=${Math.floor(now / AGE_BUCKET_MS)}`].join('|');
}

/** Providers of not-configured regions, reported as skipped (never silently absent). */
export function disabledProviders(regions: readonly CctvRegion[]): Providers {
  const out: Providers = {};
  for (const r of regions) for (const d of providersIn(r)) out[d.row.id] = skippedProvider(skipReasonOf(d)).status;
  return out;
}

export async function cctvResponse(req: Request, regions: readonly CctvRegion[], env: Record<string, string | undefined> = process.env): Promise<Response> {
  const disabledRegions = regions.filter((r) => regionDisabled(r, (c) => hasCapability(c, env)));
  const active = regions.filter((r) => !disabledRegions.includes(r));
  const skipped = disabledProviders(disabledRegions);
  if (!active.length) {
    const meta: FeedMeta = {
      feed: 'cctv',
      kind: 'live',
      state: 'offline',
      fetchedAt: null,
      observedAt: null,
      lastGoodAt: null,
      stale: false,
      ttlSeconds: Math.round(INVENTORY_TTL_MS / 1000),
      attribution: [],
      note: `Not configured on this instance: ${disabledRegions.join(', ')} camera providers need an operator key (see /api/health capabilities). Nothing was requested upstream.`,
    };
    return json({ fields: CAMERA_FIELDS, rows: [], regions: [], pendingRegions: [], disabledRegions, counts: {}, meta, providers: skipped }, { ttl: CCTV_EDGE_TTL_S });
  }
  const results = await collectRegions(active, undefined, env);
  const merged = mergeMeta(results);
  const meta = merged.meta;
  const providers: Providers = { ...skipped, ...merged.providers };
  const served = results.filter((r) => r.res.data !== null);
  const pendingRegions = results.filter((r) => r.res.data === null && r.pending).map((r) => r.region);
  if (!served.length) {
    return json(
      { error: 'source_offline', detail: pendingRegions.length ? 'Camera regions are still loading; retry the pendingRegions.' : 'No camera provider answered for these regions.', pendingRegions, disabledRegions, meta, providers },
      { status: 503, ttl: 0, headers: { 'Retry-After': pendingRegions.length ? '15' : '60' } },
    );
  }
  const counts = Object.fromEntries(served.map((r) => [r.region, r.res.data!.length]));
  const config = `lo=${env.CCTV_LINK_OUT_ONLY ?? ''}|${gateSignature(active, env)}`;
  const version = cctvVersion(served.map((r) => ({ region: r.region, fetchedAt: r.res.meta.fetchedAt, state: r.res.meta.state })), pendingRegions, disabledRegions, config);
  const key = `cctv:${regions.join(',')}`;
  return compressedJson(
    req,
    key,
    version,
    () => ({
      fields: CAMERA_FIELDS,
      rows: toRows(served.flatMap((r) => r.res.data!), env),
      regions: served.map((r) => r.region),
      pendingRegions,
      disabledRegions,
      counts,
      meta,
      providers,
    }),
    pendingRegions.length || meta.state === 'stale' ? 15 : CCTV_EDGE_TTL_S,
  );
}
