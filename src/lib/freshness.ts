/**
 * Honest freshness badges (§0.3): LIVE / <age> / STALE / OFFLINE / REFERENCE.
 * Feed-level state comes from fetch success and fetch age; entity-level state comes from the
 * entity's own observation time. Never show LIVE for data that was not observed recently.
 * Owner: lead. Isomorphic.
 */
import type { FreshnessState } from './types';

export interface FreshnessInput {
  kind: 'live' | 'reference' | 'mixed';
  /** ms epoch of the observation (entity) or of the successful fetch (feed); null if never. */
  at: number | null;
  /** Expected update cadence in ms (feed TTL or sensor cadence). */
  cadenceMs: number;
  /** The last refresh failed (serving last-good data). */
  failed?: boolean;
  now?: number;
}

/**
 * `live` within 1.5× cadence, `recent` within 6× cadence, then `stale`; failures are never live.
 * Reference data is REFERENCE even without an observation time (unless it failed to load at all).
 * A timestamp more than a minute in the future (clock skew, a validity end misused as observation)
 * is never LIVE.
 */
export function freshnessState({ kind, at, cadenceMs, failed = false, now = Date.now() }: FreshnessInput): FreshnessState {
  if (kind === 'reference') return failed && at === null ? 'offline' : 'reference';
  if (at === null) return 'offline';
  if (at - now > 60_000) return 'stale';
  const age = Math.max(0, now - at);
  if (failed) return age <= cadenceMs * 6 ? 'stale' : 'offline';
  if (age <= cadenceMs * 1.5) return 'live';
  if (age <= cadenceMs * 6) return 'recent';
  return 'stale';
}

export interface EntityFreshnessInput {
  kind: 'live' | 'reference' | 'mixed';
  /** The entity's own observation time (ms epoch), null when unknown. */
  at: number | null;
  /**
   * LayerDef.observationCadenceMs: how often a sensor re-observes this entity (aircraft 60 s,
   * vessels 10 min). `null` = event layer (quakes, fires, alerts): events are not re-observed, so
   * the card inherits the FEED state and shows the event's age as text instead.
   */
  observationCadenceMs: number | null;
  /** The feed's own state (meta.state). */
  feedState: FreshnessState;
  now?: number;
}

/** Entity-card badge state (§0.3). Never LIVE when the feed is not. */
export function entityFreshness({ kind, at, observationCadenceMs, feedState, now = Date.now() }: EntityFreshnessInput): FreshnessState {
  if (kind === 'reference') return 'reference';
  if (feedState === 'offline') return 'offline';
  if (observationCadenceMs === null) return at !== null && at - now > 60_000 ? 'stale' : feedState;
  const own = freshnessState({ kind, at, cadenceMs: observationCadenceMs, now });
  const rank: Record<FreshnessState, number> = { live: 0, recent: 1, stale: 2, offline: 3, reference: 0 };
  return rank[own] >= rank[feedState] ? own : feedState;
}

/**
 * Normalise an upstream UTC timestamp that lacks a zone designator (NOAA Kp/RTSW `time_tag`,
 * GDACS dates, CelesTrak EPOCH, SWPC `issue_datetime` "YYYY-MM-DD hh:mm:ss.sss") to ISO-8601 Z.
 * Only for fields documented as UTC. Returns null when unparseable.
 */
export function normalizeUtc(value: string | null | undefined): string | null {
  if (!value) return null;
  let v = value.trim().replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) v += 'T00:00:00';
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(v)) v += 'Z';
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Compact age: 45s, 2m, 3h, 2d. */
export function formatAge(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** Badge text for a state: LIVE, "2m", STALE, OFFLINE or REFERENCE. */
export function freshnessLabel(state: FreshnessState, at: number | null, now = Date.now()): string {
  switch (state) {
    case 'live':
      return 'LIVE';
    case 'recent':
      return at === null ? 'STALE' : formatAge(now - at);
    case 'stale':
      return 'STALE';
    case 'offline':
      return 'OFFLINE';
    case 'reference':
      return 'REFERENCE';
  }
}

export const FRESHNESS_COLOR_TOKEN: Record<FreshnessState, string> = {
  live: '--alert-green',
  recent: '--gold-primary',
  stale: '--alert-orange',
  offline: '--alert-red',
  reference: '--text-secondary',
};

export function toIso(ms: number | null | undefined): string | null {
  return ms == null || !Number.isFinite(ms) || ms <= 0 ? null : new Date(ms).toISOString();
}
