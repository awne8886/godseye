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

/** `live` within 1.5× cadence, `recent` within 6× cadence, then `stale`; failures are never live. */
export function freshnessState({ kind, at, cadenceMs, failed = false, now = Date.now() }: FreshnessInput): FreshnessState {
  if (at === null) return 'offline';
  if (kind === 'reference') return 'reference';
  const age = Math.max(0, now - at);
  if (failed) return age <= cadenceMs * 6 ? 'stale' : 'offline';
  if (age <= cadenceMs * 1.5) return 'live';
  if (age <= cadenceMs * 6) return 'recent';
  return 'stale';
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
