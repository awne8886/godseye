/**
 * Satellite catalogue feed: CelesTrak OMM JSON (primary) with a labelled SatNOGS TLE fallback.
 * Server-only. Owner: layers-space.
 *
 * CelesTrak politeness (docs/reference/23 §12, probed 2026-09-30 and 2026-10-01):
 *  - data updates every 2 h and `active` may be downloaded at most once per update → 2 h TTL and
 *    never a second `active` download within ACTIVE_INTERVAL_MS of a good one;
 *  - 50 HTTP errors (301/403/404) in 2 h firewalls the IP, and this sandbox sees connection resets
 *    on ~30 % of requests (11 s each, random groups, 2026-10-01) → every failure is counted in a
 *    rolling 2 h window; at ERROR_BUDGET the feed stops calling CelesTrak (`skipped: 'budget'`);
 *  - requests are paced by providerBucket('celestrak') and never retried immediately;
 *  - 403 means "not updated since the last download" (still an error for the firewall count).
 *
 * Between the 2 h refreshes a small recovery loop (`satelliteRecoveryTick`, driven from the route)
 *  - leaves the SatNOGS fallback as soon as CelesTrak answers: it retries `active` after 20, 40,
 *    80 then every 120 min and hands a good download straight to the feed (no second download);
 *  - re-fetches classification groups that are missing (reset / timeout) after 20 min instead of
 *    waiting for the next 2 h run.
 * Group membership is kept per group with its own download time (GROUP_TTL_MS), so a run only
 * asks for groups that are missing or old, and a run tolerates MAX_GROUP_FAILURES before stopping.
 */
import 'server-only';
import { httpJson, HttpError } from '@/lib/http';
import { providerBucket } from '@/lib/ratelimit';
import { runProvider, skippedProvider, type FeedContext, type FeedData, type ProviderRun } from '@/lib/feeds';
import type { Omm, SatCategory } from '@/lib/types';
import { CELESTRAK_GROUPS, COL, countByCategory, epochMs, ommToRecord, recordToRow, rowToRecord, classifySatellite, tleToOmm, type SatRow } from '../lib/catalog';

export const CELESTRAK_BASE = 'https://celestrak.org/NORAD/elements/gp.php';
export const SATNOGS_TLE_URL = 'https://db.satnogs.org/api/tle/?format=json';

export const celestrakUrl = (group: string) => `${CELESTRAK_BASE}?GROUP=${encodeURIComponent(group)}&FORMAT=json`;

const MIN = 60_000;
/** CelesTrak updates GP data every 2 h: never download `active` twice within this. */
export const ACTIVE_INTERVAL_MS = 120 * MIN;
/** Group membership changes slowly: a group is re-downloaded when its copy is older than this. */
export const GROUP_TTL_MS = 12 * 60 * MIN;
/** Missing groups are retried this long after the last group attempt (not after the 2 h TTL). */
export const GROUP_RETRY_MS = 20 * MIN;
/** Group failures one run tolerates before it stops asking (the rest wait for the next attempt). */
export const MAX_GROUP_FAILURES = 2;
/** Back-off before each CelesTrak retry while the SatNOGS fallback is served: 20, 40, 80, then 120 min. */
export const FALLBACK_BACKOFF_MS = [20 * MIN, 40 * MIN, 80 * MIN, 120 * MIN] as const;
/** A prefetched `active` download is handed to the feed only while this fresh. */
const PENDING_MAX_AGE_MS = 10 * MIN;
/** How long past ACTIVE_INTERVAL_MS the feed's own refresh may lag before the recovery loop asks for it. */
const ELEMENTS_GRACE_MS = 10 * MIN;
const MAX_FALLBACK_AGE_MS = 24 * 60 * MIN;

/** Feed payload kept in the snapshot store (rows already in SATELLITE_FIELDS order). */
export interface SatCatalogue {
  rows: SatRow[];
  categoryCounts: Record<SatCategory, number>;
  source: 'celestrak' | 'satnogs';
  /** ms epoch the element sets were downloaded (not their epochs). */
  elementsFetchedAt: number;
  /** CelesTrak group → NORAD ids, reused for groups that failed on a later run. */
  groupMembers: Record<string, number[]>;
  /** CelesTrak group → ms epoch its membership was downloaded (absent in snapshots before 2026-10-01). */
  groupFetchedAt?: Record<string, number>;
  /** Records dropped because a field SGP4 needs was missing or invalid. */
  dropped: number;
  /** The `active` download that produced `rows`, carried into group-only refreshes so its age stays true. */
  activeRun?: ProviderRun;
  /** Element sets whose epoch lies after the download time (CelesTrak publishes a few, e.g. CXO). */
  futureEpochs?: number;
}

// ── Error budget (rolling 2 h window, per process) ─────────────────────────────────
const WINDOW_MS = 2 * 60 * MIN;
/** Stop well short of CelesTrak's 50-errors-in-2-h firewall. */
export const ERROR_BUDGET = 12;

interface RecoveryState {
  errors: number[];
  /** Consecutive failed CelesTrak attempts while the SatNOGS fallback is served. */
  failures: number;
  lastAttemptAt: number;
  /** The newest recovery attempt (shown as `celestrak` in providers while the fallback is served). */
  lastRun: ProviderRun | null;
  lastGroupAttemptAt: number;
  lastElementsKickAt: number;
  pendingActive: { list: Partial<Omm>[]; run: ProviderRun; at: number } | null;
  pendingGroups: Record<string, { ids: number[]; at: number }>;
  busy: boolean;
}

const G = globalThis as unknown as { __godseyeCelestrakV2?: RecoveryState };
const state: RecoveryState = (G.__godseyeCelestrakV2 ??= {
  errors: [],
  failures: 0,
  lastAttemptAt: 0,
  lastRun: null,
  lastGroupAttemptAt: 0,
  lastElementsKickAt: 0,
  pendingActive: null,
  pendingGroups: {},
  busy: false,
});

export function recordCelestrakError(now = Date.now()): void {
  state.errors.push(now);
  prune(now);
}

function prune(now: number): void {
  while (state.errors.length && now - state.errors[0]! > WINDOW_MS) state.errors.shift();
}

export function celestrakErrorCount(now = Date.now()): number {
  prune(now);
  return state.errors.length;
}

/** Test hook: forget errors, back-off and anything prefetched. */
export function resetCelestrakErrors(): void {
  state.errors.length = 0;
  state.failures = 0;
  state.lastAttemptAt = 0;
  state.lastRun = null;
  state.lastGroupAttemptAt = 0;
  state.lastElementsKickAt = 0;
  state.pendingActive = null;
  state.pendingGroups = {};
  state.busy = false;
}

/** CelesTrak: one request every 2 s at most. */
const celestrakBucket = () => providerBucket('celestrak', 0.5);
const satnogsBucket = () => providerBucket('satnogs', 0.2);

async function fetchGroup(group: string, signal: AbortSignal): Promise<Partial<Omm>[]> {
  try {
    const res = await httpJson<unknown>(celestrakUrl(group), {
      retries: 0,
      timeoutMs: 60_000,
      maxBytes: 40 * 1024 * 1024,
      maxRedirects: 0,
      limiter: celestrakBucket(),
      signal,
    });
    // CelesTrak answers some errors with 200 + a text body ("GROUP not found", "has not updated").
    if (!Array.isArray(res.data)) throw new HttpError('CelesTrak returned a non-array body', 'parse', res.url, res.status);
    return res.data as Partial<Omm>[];
  } catch (e) {
    recordCelestrakError();
    throw e;
  }
}

const idsOf = (list: readonly Partial<Omm>[]) => list.map((o) => o.NORAD_CAT_ID).filter((n): n is number => typeof n === 'number');

/** Groups whose membership is missing or older than GROUP_TTL_MS, in CELESTRAK_GROUPS order. */
export function dueGroups(prev: Pick<SatCatalogue, 'groupMembers' | 'groupFetchedAt'> | null, now = Date.now()): string[] {
  return CELESTRAK_GROUPS.map((g) => g.group).filter((g) => {
    const at = prev?.groupFetchedAt?.[g];
    return !prev?.groupMembers[g] || at === undefined || now - at >= GROUP_TTL_MS;
  });
}

interface GroupRefresh {
  members: Record<string, number[]>;
  fetchedAt: Record<string, number>;
  run: ProviderRun;
  /** Groups downloaded by this refresh (including a prefetch handed over by the recovery loop). */
  fetched: number;
}

/** Fetch the due groups (paced, ≤ MAX_GROUP_FAILURES); everything else keeps its previous membership. */
async function fetchGroups(names: readonly string[], signal: AbortSignal): Promise<{ got: Record<string, { ids: number[]; at: number }>; failed: number; ms: number }> {
  const got: Record<string, { ids: number[]; at: number }> = {};
  let failed = 0;
  const t0 = Date.now();
  for (const g of names) {
    if (failed >= MAX_GROUP_FAILURES || signal.aborted || celestrakErrorCount() >= ERROR_BUDGET) break;
    try {
      got[g] = { ids: idsOf(await fetchGroup(g, signal)), at: Date.now() };
    } catch {
      failed++;
    }
  }
  return { got, failed, ms: Date.now() - t0 };
}

/**
 * Merge the recovery loop's prefetch, then (when `fetchDue`) download the groups still due. A
 * group-only refresh passes `fetchDue: false`: the groups that just failed are not asked again.
 */
async function refreshGroups(prev: SatCatalogue | null, signal: AbortSignal, now: number, fetchDue = true): Promise<GroupRefresh> {
  const members: Record<string, number[]> = { ...(prev?.groupMembers ?? {}) };
  const fetchedAt: Record<string, number> = { ...(prev?.groupFetchedAt ?? {}) };
  // A prefetch from the recovery loop counts as this run's download of those groups.
  const handed = state.pendingGroups;
  state.pendingGroups = {};
  for (const [g, v] of Object.entries(handed)) {
    members[g] = v.ids;
    fetchedAt[g] = v.at;
  }
  const due = fetchDue ? dueGroups({ groupMembers: members, groupFetchedAt: fetchedAt }, now) : [];
  const r = due.length ? await fetchGroups(due, signal) : { got: {}, failed: 0, ms: 0 };
  for (const [g, v] of Object.entries(r.got)) {
    members[g] = v.ids;
    fetchedAt[g] = v.at;
  }
  if (due.length) state.lastGroupAttemptAt = Date.now();
  const total = CELESTRAK_GROUPS.length;
  const have = CELESTRAK_GROUPS.filter((g) => members[g.group]).length;
  const current = CELESTRAK_GROUPS.filter((g) => fetchedAt[g.group] !== undefined && now - fetchedAt[g.group]! < GROUP_TTL_MS).length;
  const ok = have === total && current === total;
  const newest = Math.max(0, ...Object.values(fetchedAt));
  return {
    members,
    fetchedAt,
    fetched: Object.keys(r.got).length + Object.keys(handed).length,
    run: {
      status: {
        ok,
        count: Object.values(members).reduce((n, ids) => n + ids.length, 0),
        ms: r.ms,
        age_s: null,
        ...(ok ? {} : { error: `groups ${have}/${total}` }),
      },
      okAt: newest || null,
    },
  };
}

/** Back-off before the next CelesTrak attempt after `failures` consecutive failures. */
export function fallbackBackoffMs(failures: number): number {
  return FALLBACK_BACKOFF_MS[Math.min(Math.max(failures, 0), FALLBACK_BACKOFF_MS.length - 1)]!;
}

/**
 * One refresh. `active` first (a recovery prefetch counts); then the due classification groups.
 * Without a new `active` download (it is < 2 h old) a refresh only re-classifies with the groups the
 * recovery loop handed over. If `active` fails: keep the last-good CelesTrak catalogue (throw →
 * stale with last-good time) while it is < 24 h old, else use SatNOGS, labelled `satnogs-fallback`.
 */
export async function runSatellites(ctx: FeedContext<SatCatalogue>): Promise<FeedData<SatCatalogue>> {
  const now = Date.now();
  const providers: Record<string, ProviderRun> = {};
  const prev = ctx.previous;
  const prevCelestrak = prev?.source === 'celestrak' ? prev : null;
  const handedGroups = Object.keys(state.pendingGroups).length > 0;
  const pending = state.pendingActive && now - state.pendingActive.at < PENDING_MAX_AGE_MS ? state.pendingActive : null;
  state.pendingActive = null;
  // Group-only refresh: the elements are < 2 h old and the recovery loop brought new group data.
  const groupOnly = !pending && prevCelestrak !== null && handedGroups && now - prevCelestrak.elementsFetchedAt < ACTIVE_INTERVAL_MS;

  let active: Partial<Omm>[] | null = null;
  if (pending) {
    providers.celestrak = pending.run;
    active = pending.list;
  } else if (!groupOnly) {
    if (celestrakErrorCount() >= ERROR_BUDGET) {
      providers.celestrak = skippedProvider('budget');
    } else {
      const r = await runProvider(() => fetchGroup('active', ctx.signal), (d) => d.length);
      providers.celestrak = r.run;
      active = r.result && r.result.length ? r.result : null;
    }
  }

  if (active) {
    state.failures = 0;
    state.lastRun = null;
    const g = await refreshGroups(prevCelestrak, ctx.signal, now);
    providers['celestrak-groups'] = g.run;
    const elementsFetchedAt = pending?.at ?? now;
    return build(active, groupsLookup(g.members), 'celestrak', g, providers, elementsFetchedAt, providers.celestrak!);
  }

  if (groupOnly && prevCelestrak) {
    const g = await refreshGroups(prevCelestrak, ctx.signal, now, false);
    providers['celestrak-groups'] = g.run;
    if (prevCelestrak.activeRun) providers.celestrak = prevCelestrak.activeRun;
    return reclassify(prevCelestrak, g, providers);
  }

  // CelesTrak unavailable.
  if (prevCelestrak && now - prevCelestrak.elementsFetchedAt < MAX_FALLBACK_AGE_MS) {
    throw new Error('celestrak unavailable; serving last-good catalogue');
  }
  state.failures = prev?.source === 'satnogs' ? state.failures + 1 : Math.max(state.failures, 1);
  state.lastAttemptAt = now;
  state.lastRun = providers.celestrak ?? null;
  const sn = await runProvider(() => fetchSatnogs(ctx.signal), (d) => d.length);
  providers['satnogs-fallback'] = sn.run;
  if (!sn.result || sn.result.length === 0) throw new Error('no satellite catalogue source answered');
  return build(sn.result, () => ['satnogs'], 'satnogs', null, providers, now, null);
}

function groupsLookup(members: Record<string, number[]>): (o: Partial<Omm>) => string[] {
  const byId = new Map<number, string[]>();
  for (const [group, ids] of Object.entries(members)) for (const id of ids) byId.set(id, [...(byId.get(id) ?? ['active']), group]);
  return (o) => byId.get(o.NORAD_CAT_ID as number) ?? ['active'];
}

/**
 * `observedAt` for a catalogue: the newest element-set epoch that is NOT after the download.
 * CelesTrak publishes some epochs in the future (CXO 25867: 2026-10-02T03:42Z when downloaded at
 * 2026-10-01T06:14Z); an epoch is a validity time, not an observation, so a future one never
 * becomes the feed's timestamp. Per-object epochs are served unchanged.
 */
export function catalogueObservedAt(epochs: Iterable<number>, fetchedAt: number): { observedAt: number | null; future: number } {
  let newest = 0;
  let future = 0;
  for (const t of epochs) {
    if (!Number.isFinite(t)) continue;
    if (t > fetchedAt) future++;
    else if (t > newest) newest = t;
  }
  return { observedAt: newest || null, future };
}

function build(
  omms: readonly Partial<Omm>[],
  groupsOf: (o: Partial<Omm>) => string[],
  source: SatCatalogue['source'],
  groups: GroupRefresh | null,
  providers: Record<string, ProviderRun>,
  elementsFetchedAt: number,
  activeRun: ProviderRun | null,
): FeedData<SatCatalogue> {
  const seen = new Set<number>();
  const rows: SatRow[] = [];
  let dropped = 0;
  for (const o of omms) {
    const rec = ommToRecord(o, groupsOf(o));
    if (!rec) {
      dropped++;
      continue;
    }
    if (seen.has(rec.noradId)) continue;
    seen.add(rec.noradId);
    rows.push(recordToRow(rec));
  }
  const { observedAt, future } = catalogueObservedAt(
    rows.map((r) => epochMs(r[COL.epoch])),
    elementsFetchedAt,
  );
  return {
    data: {
      rows,
      categoryCounts: countByCategory(rows),
      source,
      elementsFetchedAt,
      groupMembers: groups?.members ?? {},
      groupFetchedAt: groups?.fetchedAt ?? {},
      dropped,
      ...(activeRun ? { activeRun } : {}),
      futureEpochs: future,
    },
    providers,
    observedAt,
  };
}

/** Same element sets, classification re-run with the new group membership. */
function reclassify(prev: SatCatalogue, groups: GroupRefresh, providers: Record<string, ProviderRun>): FeedData<SatCatalogue> {
  const lookup = groupsLookup(groups.members);
  const rows = prev.rows.map((row) => {
    const rec = rowToRecord(row);
    return recordToRow({ ...rec, ...classifySatellite(rec.name, lookup({ NORAD_CAT_ID: rec.noradId })) });
  });
  const { observedAt, future } = catalogueObservedAt(
    rows.map((r) => epochMs(r[COL.epoch])),
    prev.elementsFetchedAt,
  );
  return {
    data: { ...prev, rows, categoryCounts: countByCategory(rows), groupMembers: groups.members, groupFetchedAt: groups.fetchedAt, futureEpochs: future },
    providers,
    observedAt,
  };
}

// ── Recovery loop (between the 2 h refreshes) ────────────────────────────────────

/** What the recovery loop should do for this snapshot now, if anything. */
export type RecoveryAction = 'celestrak' | 'groups' | 'elements';

export function recoveryAction(cat: SatCatalogue | null, now = Date.now()): RecoveryAction | null {
  if (!cat || celestrakErrorCount(now) >= ERROR_BUDGET) return null;
  if (cat.source === 'satnogs') {
    const since = Math.max(state.lastAttemptAt, cat.elementsFetchedAt);
    return now - since >= fallbackBackoffMs(state.failures - 1) ? 'celestrak' : null;
  }
  if (now - cat.elementsFetchedAt >= ACTIVE_INTERVAL_MS + ELEMENTS_GRACE_MS) {
    // A group-only refresh restarted the cache TTL: make sure the 2-hourly `active` download is not delayed.
    return now - state.lastElementsKickAt >= GROUP_RETRY_MS ? 'elements' : null;
  }
  if (now - cat.elementsFetchedAt >= ACTIVE_INTERVAL_MS) return null; // the feed's own refresh is due
  const missing = CELESTRAK_GROUPS.some((g) => !cat.groupMembers[g.group] || cat.groupFetchedAt?.[g.group] === undefined);
  return missing && now - state.lastGroupAttemptAt >= GROUP_RETRY_MS ? 'groups' : null;
}

/**
 * One recovery step: prefetch what is due and, when something answered, hand it to the feed via
 * `refresh()` (the run uses the prefetch; nothing is downloaded twice). A failed attempt changes
 * nothing in the snapshot; it is reported through `recoveryProviders()`.
 */
export async function satelliteRecoveryTick(cat: SatCatalogue | null, refresh: () => Promise<unknown>, now = Date.now()): Promise<RecoveryAction | null> {
  const action = recoveryAction(cat, now);
  if (!action || state.busy || !cat) return null;
  state.busy = true;
  if (action === 'elements') {
    // refresh() honours the feed's error back-off, so this never hammers a failing CelesTrak.
    state.lastElementsKickAt = now;
    try {
      await refresh();
    } finally {
      state.busy = false;
    }
    return action;
  }
  const signal = AbortSignal.timeout(120_000);
  try {
    if (action === 'celestrak') {
      state.lastAttemptAt = now;
      const r = await runProvider(() => fetchGroup('active', signal), (d) => d.length);
      if (r.result && r.result.length) {
        state.pendingActive = { list: r.result, run: r.run, at: Date.now() };
        await refresh();
      } else {
        state.failures++;
        state.lastRun = r.run;
      }
      return action;
    }
    const names = CELESTRAK_GROUPS.map((g) => g.group).filter((g) => !cat.groupMembers[g] || cat.groupFetchedAt?.[g] === undefined);
    state.lastGroupAttemptAt = now;
    const r = await fetchGroups(names, signal);
    if (Object.keys(r.got).length) {
      state.pendingGroups = { ...state.pendingGroups, ...r.got };
      await refresh();
    }
    return action;
  } finally {
    state.busy = false;
  }
}

/**
 * While the SatNOGS fallback is served, the newest CelesTrak attempt (from the recovery loop) replaces
 * the snapshot's older `celestrak` entry, so providers always show the latest try and its error.
 */
export function recoveryProviders<P extends Record<string, { ok: boolean }>>(cat: SatCatalogue | null, providers: P, now = Date.now()): P {
  if (cat?.source !== 'satnogs' || !state.lastRun) return providers;
  const r = state.lastRun;
  return { ...providers, celestrak: { ...r.status, age_s: r.okAt ? Math.round((now - r.okAt) / 1000) : null } };
}

/** When the next CelesTrak attempt is due while the fallback is served (ms epoch), else null. */
export function nextCelestrakAttemptAt(cat: SatCatalogue | null): number | null {
  if (cat?.source !== 'satnogs') return null;
  return Math.max(state.lastAttemptAt, cat.elementsFetchedAt) + fallbackBackoffMs(state.failures - 1);
}

interface SatnogsTle {
  tle0?: unknown;
  tle1?: unknown;
  tle2?: unknown;
  norad_cat_id?: unknown;
}

/** SatNOGS DB TLE list (~1.7k objects, 520 kB, 2026-10-01) converted to OMM. */
export async function fetchSatnogs(signal: AbortSignal): Promise<Omm[]> {
  const res = await httpJson<unknown>(SATNOGS_TLE_URL, { retries: 1, timeoutMs: 30_000, maxBytes: 20 * 1024 * 1024, limiter: satnogsBucket(), signal });
  const list = Array.isArray(res.data) ? (res.data as SatnogsTle[]) : [];
  const out: Omm[] = [];
  for (const t of list) {
    if (typeof t.tle1 !== 'string' || typeof t.tle2 !== 'string' || typeof t.norad_cat_id !== 'number') continue;
    const omm = tleToOmm(typeof t.tle0 === 'string' ? t.tle0 : '', t.tle1, t.tle2, t.norad_cat_id);
    if (omm) out.push(omm);
  }
  return out;
}
