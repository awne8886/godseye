// Phase 1 review A regressions (R-A1, R-A12, future timestamps, normalizeUtc).
import { describe, expect, it } from 'vitest';
import { entityFreshness, freshnessLabel, freshnessState, normalizeUtc } from '@/lib/freshness';

const now = Date.parse('2026-09-30T12:00:00Z');

describe('freshness', () => {
  it('reference entities badge REFERENCE even with observedAt null', () => {
    const state = freshnessState({ kind: 'reference', at: null, cadenceMs: 86_400_000 });
    expect(state).toBe('reference');
    expect(freshnessLabel(state, null)).toBe('REFERENCE');
    expect(freshnessState({ kind: 'reference', at: null, cadenceMs: 1, failed: true })).toBe('offline');
  });

  it('event entities inherit the feed state instead of comparing their age with the poll interval', () => {
    const quake = { kind: 'live' as const, at: now - 2 * 3_600_000, observationCadenceMs: null, now };
    expect(entityFreshness({ ...quake, feedState: 'live' })).toBe('live');
    expect(entityFreshness({ ...quake, feedState: 'stale' })).toBe('stale');
    expect(entityFreshness({ ...quake, feedState: 'offline' })).toBe('offline');
  });

  it('sensor tracks use their own observation age, never fresher than the feed', () => {
    const plane = { kind: 'live' as const, observationCadenceMs: 60_000, now };
    expect(entityFreshness({ ...plane, at: now - 20_000, feedState: 'live' })).toBe('live');
    expect(entityFreshness({ ...plane, at: now - 30 * 60_000, feedState: 'live' })).toBe('stale');
    expect(entityFreshness({ ...plane, at: now - 20_000, feedState: 'recent' })).toBe('recent');
  });

  it('an observation stamped in the future never reads LIVE', () => {
    const at = Date.parse('2026-10-01T12:00:00Z');
    expect(freshnessState({ kind: 'live', at, cadenceMs: 60_000, now })).toBe('stale');
    expect(entityFreshness({ kind: 'live', at, observationCadenceMs: null, feedState: 'live', now })).toBe('stale');
  });

  it('normalises zone-less UTC timestamps from NOAA, GDACS, CelesTrak and SWPC', () => {
    expect(normalizeUtc('2026-09-30T12:00:00')).toBe('2026-09-30T12:00:00.000Z');
    expect(normalizeUtc('2026-09-30 17:27:05.123')).toBe('2026-09-30T17:27:05.123Z');
    expect(normalizeUtc('2026-09-30T03:25:12.177120')).toBe('2026-09-30T03:25:12.177Z');
    expect(normalizeUtc('2026-09-30T12:00:00+01:00')).toBe('2026-09-30T11:00:00.000Z');
    expect(normalizeUtc('2026-09-30')).toBe('2026-09-30T00:00:00.000Z');
    expect(normalizeUtc('garbage')).toBeNull();
    expect(normalizeUtc(null)).toBeNull();
  });
});
