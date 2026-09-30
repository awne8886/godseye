/**
 * Camera catalogue: one feed per region (`cctv:<region>`, 30-min inventory, 5-min back-off after a
 * failure), each running its providers in parallel through runProvider() so every response carries
 * `providers: {name: {ok, count, ms, age_s}}`. A provider that fails keeps its last-good rows (its
 * status still reports the failure). Keyed providers report skippedProvider('not-configured').
 * Owner: layers-surveillance. Server-only.
 */
import 'server-only';
import { hasCapability } from '@/lib/capabilities';
import { defineFeed, runProvider, skippedProvider, type Feed, type ProviderRun } from '@/lib/feeds';
import type { Camera } from '@/lib/types';
import { CCTV_REGIONS, providerIdOf, type CctvRegion } from '../shared';
import { LOADERS, type Loader } from './loaders';
import { isRemoved, providerDef, providersIn, type ProviderDef } from './registry';

const MIN = 60_000;
export const INVENTORY_TTL_MS = 30 * MIN;
export const REGION_BACKOFF_MS = 5 * MIN;

/** Run one region's providers; keeps a failed provider's previous rows so the map does not flicker. */
export async function runRegion(
  defs: readonly ProviderDef[],
  previous: Camera[] | null,
  signal: AbortSignal,
  loaders: Record<string, Loader> = LOADERS,
  env: Record<string, string | undefined> = process.env,
) {
  const providers: Record<string, ProviderRun> = {};
  const rows: Camera[] = [];
  await Promise.all(
    defs.map(async (d) => {
      const id = d.row.id;
      if (d.capability && !hasCapability(d.capability, env)) {
        providers[id] = skippedProvider('not-configured');
        return;
      }
      const load = loaders[id];
      if (!load) {
        providers[id] = skippedProvider('disabled');
        return;
      }
      const { result, run } = await runProvider(() => load(signal), (r) => r.length);
      providers[id] = run;
      if (result && result.length) rows.push(...result.filter((c) => !isRemoved(c.id, env)));
      else if (previous) rows.push(...previous.filter((c) => c.providerId === id));
    }),
  );
  rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const observed = rows.reduce((m, c) => (c.observedAt ? Math.max(m, Date.parse(c.observedAt)) : m), 0);
  return { data: rows, providers, observedAt: observed || null };
}

const G = globalThis as unknown as { __godseyeCctvFeeds?: Map<CctvRegion, Feed<Camera[]>> };
const FEEDS = (G.__godseyeCctvFeeds ??= new Map());

export function regionFeed(region: CctvRegion): Feed<Camera[]> {
  let f = FEEDS.get(region);
  if (f) return f;
  const defs = providersIn(region);
  f = defineFeed<Camera[]>({
    key: `cctv:${region}`,
    ttlMs: INVENTORY_TTL_MS,
    kind: 'live',
    attribution: defs.map((d) => ({ text: d.row.attribution_string, url: d.row.terms_url, licence: d.row.licence })),
    note: 'Camera inventory refreshed every 30 min; frames load on demand through the stills proxy (never stored).',
    retryAfterErrorMs: REGION_BACKOFF_MS,
    deadlineMs: 45_000,
    run: (ctx) => runRegion(defs, ctx.previous, ctx.signal),
    count: (d) => d.length,
  });
  FEEDS.set(region, f);
  return f;
}

export function allRegionFeeds(): Feed<Camera[]>[] {
  return CCTV_REGIONS.map(regionFeed);
}

/** Test hook: forget the feed objects (after resetFeeds()). */
export function resetRegionFeeds(): void {
  FEEDS.clear();
}

// ── Lookup by camera id (proxy, resolve, stream-status) ─────────────────────────
const INDEX = new WeakMap<Camera[], Map<string, Camera>>();

function indexOf(rows: Camera[]): Map<string, Camera> {
  let m = INDEX.get(rows);
  if (!m) {
    m = new Map(rows.map((c) => [c.id, c]));
    INDEX.set(rows, m);
  }
  return m;
}

export const CAMERA_ID = /^[a-z]{2,16}-[^\u0000-\u001f\u007f]{1,160}$/;

/** Find a catalogued camera by id; only ids from the catalogue ever reach an upstream. */
export async function findCamera(id: string, budgetMs = 12_000): Promise<{ camera: Camera; def: ProviderDef } | null> {
  if (!CAMERA_ID.test(id)) return null;
  const def = providerDef(providerIdOf(id));
  if (!def) return null;
  const feed = regionFeed(def.region);
  const peek = feed.peek();
  const result = peek.data ? peek : await Promise.race([feed.get(), new Promise<null>((r) => setTimeout(() => r(null), budgetMs).unref?.())]);
  const cam = result?.data ? indexOf(result.data).get(id) : undefined;
  return cam ? { camera: cam, def } : null;
}
