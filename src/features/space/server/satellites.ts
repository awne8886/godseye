/**
 * Satellite catalogue feed: CelesTrak OMM JSON (primary) with a labelled SatNOGS TLE fallback.
 * Server-only. Owner: layers-space.
 *
 * CelesTrak politeness (docs/reference/23 §12, probed 2026-09-30):
 *  - data updates every 2 h and `active` may be downloaded at most once per update → 2 h TTL/poll;
 *  - 50 HTTP errors (301/403/404) in 2 h firewalls the IP, and this sandbox saw TLS resets → every
 *    failure is counted in a rolling 2 h window; at ERROR_BUDGET the feed stops calling CelesTrak
 *    (`skipped: 'budget'`) until the window drains; a run stops at its first group failure;
 *  - requests are paced by providerBucket('celestrak') and never retried automatically;
 *  - 403 means "not updated since the last download" (still an error for the firewall count).
 */
import 'server-only';
import { httpJson, HttpError } from '@/lib/http';
import { providerBucket } from '@/lib/ratelimit';
import { runProvider, skippedProvider, type FeedContext, type FeedData, type ProviderRun } from '@/lib/feeds';
import type { Omm, SatCategory } from '@/lib/types';
import { CELESTRAK_GROUPS, countByCategory, ommToRecord, recordToRow, tleToOmm, type SatRow } from '../lib/catalog';

export const CELESTRAK_BASE = 'https://celestrak.org/NORAD/elements/gp.php';
export const SATNOGS_TLE_URL = 'https://db.satnogs.org/api/tle/?format=json';

export const celestrakUrl = (group: string) => `${CELESTRAK_BASE}?GROUP=${encodeURIComponent(group)}&FORMAT=json`;

/** Feed payload kept in the snapshot store (rows already in SATELLITE_FIELDS order). */
export interface SatCatalogue {
  rows: SatRow[];
  categoryCounts: Record<SatCategory, number>;
  source: 'celestrak' | 'satnogs';
  /** ms epoch the element sets were downloaded (not their epochs). */
  elementsFetchedAt: number;
  /** CelesTrak group → NORAD ids, reused for groups that failed on a later run. */
  groupMembers: Record<string, number[]>;
  /** Records dropped because a field SGP4 needs was missing or invalid. */
  dropped: number;
}

// ── Error budget (rolling 2 h window, per process) ─────────────────────────────────
const WINDOW_MS = 2 * 60 * 60_000;
/** Stop well short of CelesTrak's 50-errors-in-2-h firewall. */
export const ERROR_BUDGET = 12;

const G = globalThis as unknown as { __godseyeCelestrakErrors?: number[] };
const errors = (G.__godseyeCelestrakErrors ??= []);

export function recordCelestrakError(now = Date.now()): void {
  errors.push(now);
  prune(now);
}

function prune(now: number): void {
  while (errors.length && now - errors[0]! > WINDOW_MS) errors.shift();
}

export function celestrakErrorCount(now = Date.now()): number {
  prune(now);
  return errors.length;
}

/** Test hook. */
export function resetCelestrakErrors(): void {
  errors.length = 0;
}

/** CelesTrak: one request every 2 s at most (a full run is 13 requests). */
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

const MAX_FALLBACK_AGE_MS = 24 * 60 * 60_000;

/**
 * One refresh. `active` first; then the classification groups until the first failure (their
 * membership falls back to the previous run's). If `active` fails: keep the last-good CelesTrak
 * catalogue (throw → stale with last-good time) while it is < 24 h old, else use SatNOGS, labelled.
 */
export async function runSatellites(ctx: FeedContext<SatCatalogue>): Promise<FeedData<SatCatalogue>> {
  const providers: Record<string, ProviderRun> = {};
  const prev = ctx.previous;
  let active: Partial<Omm>[] | null = null;

  if (celestrakErrorCount() >= ERROR_BUDGET) {
    providers.celestrak = skippedProvider('budget');
  } else {
    const r = await runProvider(() => fetchGroup('active', ctx.signal), (d) => d.length);
    providers.celestrak = r.run;
    active = r.result && r.result.length ? r.result : null;
  }

  if (active) {
    const members: Record<string, number[]> = {};
    let stopped = false;
    let okGroups = 0;
    const t0 = Date.now();
    for (const g of CELESTRAK_GROUPS) {
      if (stopped || ctx.signal.aborted) {
        if (prev?.groupMembers[g.group]) members[g.group] = prev.groupMembers[g.group]!;
        continue;
      }
      try {
        const list = await fetchGroup(g.group, ctx.signal);
        members[g.group] = list.map((o) => o.NORAD_CAT_ID).filter((n): n is number => typeof n === 'number');
        okGroups++;
      } catch {
        stopped = true; // never hammer: the next run (≥ back-off later) tries again
        if (prev?.groupMembers[g.group]) members[g.group] = prev.groupMembers[g.group]!;
      }
    }
    const memberCount = Object.values(members).reduce((n, ids) => n + ids.length, 0);
    providers['celestrak-groups'] = {
      status: {
        ok: okGroups === CELESTRAK_GROUPS.length,
        count: memberCount,
        ms: Date.now() - t0,
        age_s: okGroups === CELESTRAK_GROUPS.length ? 0 : null,
        ...(okGroups === CELESTRAK_GROUPS.length ? {} : { error: `groups ${okGroups}/${CELESTRAK_GROUPS.length}` }),
      },
      okAt: okGroups ? Date.now() : null,
    };
    const byId = new Map<number, string[]>();
    for (const [group, ids] of Object.entries(members)) for (const id of ids) byId.set(id, [...(byId.get(id) ?? ['active']), group]);
    return build(active, (o) => byId.get(o.NORAD_CAT_ID as number) ?? ['active'], 'celestrak', members, providers);
  }

  // CelesTrak unavailable.
  if (prev && prev.source === 'celestrak' && Date.now() - prev.elementsFetchedAt < MAX_FALLBACK_AGE_MS) {
    throw new Error('celestrak unavailable; serving last-good catalogue');
  }
  const sn = await runProvider(() => fetchSatnogs(ctx.signal), (d) => d.length);
  providers.satnogs = sn.run;
  if (!sn.result || sn.result.length === 0) throw new Error('no satellite catalogue source answered');
  return build(sn.result, () => ['satnogs'], 'satnogs', {}, providers);
}

function build(
  omms: readonly Partial<Omm>[],
  groupsOf: (o: Partial<Omm>) => string[],
  source: SatCatalogue['source'],
  groupMembers: Record<string, number[]>,
  providers: Record<string, ProviderRun>,
): FeedData<SatCatalogue> {
  const seen = new Set<number>();
  const rows: SatRow[] = [];
  let dropped = 0;
  let newestEpoch = 0;
  for (const o of omms) {
    const rec = ommToRecord(o, groupsOf(o));
    if (!rec) {
      dropped++;
      continue;
    }
    if (seen.has(rec.noradId)) continue;
    seen.add(rec.noradId);
    rows.push(recordToRow(rec));
    newestEpoch = Math.max(newestEpoch, Date.parse(rec.epoch));
  }
  return {
    data: { rows, categoryCounts: countByCategory(rows), source, elementsFetchedAt: Date.now(), groupMembers, dropped },
    providers,
    // Newest element-set epoch: when the upstream last produced orbital data.
    observedAt: newestEpoch || null,
  };
}

interface SatnogsTle {
  tle0?: unknown;
  tle1?: unknown;
  tle2?: unknown;
  norad_cat_id?: unknown;
}

/** SatNOGS DB TLE list (~1.7k objects, 520 kB, 2026-09-30) converted to OMM. */
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
