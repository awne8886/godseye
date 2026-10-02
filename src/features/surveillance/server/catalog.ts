/**
 * Camera catalogue: one feed per region (`cctv:<region>`, 30-min inventory, 5-min back-off after a
 * failure), each running its providers in parallel through runProvider() so every response carries
 * `providers: {name: {ok, count, ms, age_s}}`. A provider that fails keeps its last-good rows (its
 * status still reports the failure). Keyed providers report skippedProvider('not-configured'); licence-gated ones (nc_sources off on a
 * commercial deployment) report skippedProvider('licence').
 *
 * The gates hold on every read, not only on refresh (verification round 8, BLOCKING): region
 * snapshots outlive configuration changes in the filesystem/Redis SnapshotStore, so
 * `COMMERCIAL_DEPLOYMENT=true` + restart used to keep serving (and resolving) the non-commercial
 * City of Edmonton cameras for up to INVENTORY_TTL_MS. gateRegion() now runs on every get/peek/refresh
 * of a region feed, including the registry reads of /api/health, /api/stats and the region dossier.
 * Owner: layers-surveillance. Server-only.
 */
import 'server-only';
import { hasCapability } from '@/lib/capabilities';
import { defineFeed, runProvider, skippedProvider, type Feed, type FeedResult, type ProviderRun } from '@/lib/feeds';
import type { Camera } from '@/lib/types';
import { CCTV_REGIONS, providerIdOf, type CctvRegion } from '../shared';
import { LOADERS, type Loader } from './loaders';
import { isRemoved, providerDef, providersIn, skipReasonOf, type ProviderDef } from './registry';

const MIN = 60_000;
export const INVENTORY_TTL_MS = 30 * MIN;
export const REGION_BACKOFF_MS = 5 * MIN;

type Env = Record<string, string | undefined>;

/** A provider runs, and its cameras are served, only while its capability (if any) is on. */
export function providerEnabled(def: ProviderDef, env: Env = process.env): boolean {
  return !def.capability || hasCapability(def.capability, env);
}

/** Run one region's providers; keeps a failed provider's previous rows so the map does not flicker. */
export async function runRegion(
  defs: readonly ProviderDef[],
  previous: Camera[] | null,
  signal: AbortSignal,
  loaders: Record<string, Loader> = LOADERS,
  env: Env = process.env,
) {
  const providers: Record<string, ProviderRun> = {};
  const rows: Camera[] = [];
  await Promise.all(
    defs.map(async (d) => {
      const id = d.row.id;
      if (!providerEnabled(d, env)) {
        providers[id] = skippedProvider(skipReasonOf(d));
        return;
      }
      const load = loaders[id];
      if (!load) {
        providers[id] = skippedProvider('disabled');
        return;
      }
      const { result, run } = await runProvider(() => load(signal), (r) => r.length);
      providers[id] = run;
      const kept = result && result.length ? result : previous ? previous.filter((c) => c.providerId === id) : [];
      // A camera removed since the previous snapshot never comes back through the last-good rows.
      rows.push(...kept.filter((c) => !isRemoved(c.id, env)));
    }),
  );
  rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { data: rows, providers, observedAt: newestObservation(rows) };
}

function newestObservation(rows: readonly Camera[]): number | null {
  const observed = rows.reduce((m, c) => (c.observedAt ? Math.max(m, Date.parse(c.observedAt)) : m), 0);
  return observed || null;
}

interface Gate {
  /** Providers whose capability is off on this instance. */
  off: ProviderDef[];
  offIds: ReadonlySet<string>;
  /** Changes whenever the gate would withhold different rows (off providers, removed ids). */
  signature: string;
}

/** What this instance withholds right now: providers whose capability is off, removed camera ids. */
function gateOf(defs: readonly ProviderDef[], env: Env): Gate {
  const off = defs.filter((d) => !providerEnabled(d, env));
  const ids = off.map((d) => d.row.id);
  return { off, offIds: new Set(ids), signature: `off=${ids.join('+')}|rm=${env.CCTV_REMOVED_IDS?.trim() ?? ''}` };
}

/** Gate signature for cache versions: changes whenever gateRegion() would serve different rows. */
export function gateSignature(regions: readonly CctvRegion[], env: Env = process.env): string {
  return gateOf(regions.flatMap(providersIn), env).signature;
}

/** Gated rows per stored array and gate, so findCamera's id index is not rebuilt per request. */
const GATED_ROWS = new WeakMap<Camera[], { signature: string; rows: Camera[] }>();

function gatedRows(source: Camera[], gate: Gate, env: Env): Camera[] {
  const memo = GATED_ROWS.get(source);
  if (memo && memo.signature === gate.signature) return memo.rows;
  const kept = source.filter((c) => !gate.offIds.has(c.providerId) && !isRemoved(c.id, env));
  const rows = kept.length === source.length ? source : kept;
  GATED_ROWS.set(source, { signature: gate.signature, rows });
  return rows;
}

/**
 * The read-side gate over one region's feed result: drops the rows of providers whose capability
 * is off and of removed camera ids, reports those providers with their skipped status
 * (`'licence'` / `'not-configured'`) instead of the stored run, withdraws their attribution, and
 * re-derives observedAt from the rows that remain. A snapshot left with no row from an enabled
 * provider is no data (SOURCE OFFLINE), never an empty catalogue presented as truth.
 */
export function gateRegion(res: FeedResult<Camera[]>, defs: readonly ProviderDef[], env: Env = process.env): FeedResult<Camera[]> {
  const gate = gateOf(defs, env);
  const rows = res.data ? gatedRows(res.data, gate, env) : null;
  if (!gate.off.length && rows === res.data) return res;
  const providers = { ...res.providers };
  for (const d of gate.off) providers[d.row.id] = skippedProvider(skipReasonOf(d)).status;
  const withheld = new Set(gate.off.map((d) => d.row.attribution_string));
  for (const d of defs) if (!gate.offIds.has(d.row.id)) withheld.delete(d.row.attribution_string);
  const meta = { ...res.meta, attribution: res.meta.attribution.filter((a) => !withheld.has(a.text)) };
  if (rows === res.data) return { data: rows, meta, providers };
  if (!rows?.length) return { data: null, meta: { ...meta, state: 'offline', observedAt: null }, providers };
  const newest = newestObservation(rows);
  return { data: rows, meta: { ...meta, observedAt: newest ? new Date(newest).toISOString() : null }, providers };
}

const GATED_FEEDS = new WeakSet<Feed<Camera[]>>();

/**
 * Installs gateRegion() on the region feed object itself, which is the same object the feed
 * registry hands to /api/health, /api/stats and the region dossier (getFeed/allFeeds), so no reader
 * sees an ungated snapshot. health() reads through feed.peek(), so its count and providers are
 * gated too (asserted in catalog.gate.test.ts).
 */
function gatedFeed(feed: Feed<Camera[]>, defs: readonly ProviderDef[]): Feed<Camera[]> {
  if (GATED_FEEDS.has(feed)) return feed;
  const get = feed.get.bind(feed);
  const peek = feed.peek.bind(feed);
  const refresh = feed.refresh.bind(feed);
  feed.get = async (opts) => gateRegion(await get(opts), defs);
  feed.peek = () => gateRegion(peek(), defs);
  feed.refresh = async (opts) => gateRegion(await refresh(opts), defs);
  GATED_FEEDS.add(feed);
  return feed;
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
  f = gatedFeed(f, defs);
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

/**
 * Find a catalogued camera by id; only ids from the catalogue ever reach an upstream. A camera of a
 * provider that is off on this instance (or a removed id) is not catalogued, whatever the stored
 * snapshot holds: the region read is gated, and the provider is refused before any feed is touched.
 */
export async function findCamera(id: string, budgetMs = 12_000, env: Env = process.env): Promise<{ camera: Camera; def: ProviderDef } | null> {
  if (!CAMERA_ID.test(id)) return null;
  const def = providerDef(providerIdOf(id));
  if (!def || !providerEnabled(def, env) || isRemoved(id, env)) return null;
  const feed = regionFeed(def.region);
  const peek = feed.peek();
  const result = peek.data ? peek : await Promise.race([feed.get(), new Promise<null>((r) => setTimeout(() => r(null), budgetMs).unref?.())]);
  const cam = result?.data ? indexOf(result.data).get(id) : undefined;
  return cam ? { camera: cam, def } : null;
}
