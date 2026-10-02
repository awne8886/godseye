/**
 * Round 6 BLOCKING: known services must not be LIVE from a frozen/stale flights snapshot, nor from
 * a record whose own `seenAt` is older than the flights observation cadence.
 */
import { describe, expect, it } from 'vitest';
import type { FeedResult } from '@/lib/feeds';
import type { FreshnessState, Providers } from '@/lib/types';
import { findAirport, vrsIndex } from './data';
import { knownServices, liveCallsigns } from './plan';

const NOW = Date.parse('2026-10-02T02:49:00Z');
const S = (iso: string) => Math.floor(Date.parse(iso) / 1000);

function feed(state: FreshnessState, records: { callsign: string | null; seenAt: number }[], providers: Providers = {}, fetchedAt = '2026-10-02T02:48:30Z') {
  const r = {
    data: { records },
    meta: { state, fetchedAt, lastGoodAt: fetchedAt, observedAt: fetchedAt, source: 'flights', error: null },
    providers,
  } as unknown as FeedResult<unknown>;
  return { peek: () => r };
}

const lhr = findAirport('LHR')!;
const jfk = findAirport('JFK')!;
const pair = [...new Set(vrsIndex().byPair.get('EGLL-KJFK') ?? [])].sort();

describe('liveCallsigns / knownServices freshness', () => {
  it('has standing-data services on LHR-JFK to test with', () => {
    expect(pair.length).toBeGreaterThanOrEqual(2);
  });

  it('a stale snapshot (frozen feed) marks nothing and reports ok:false stale_snapshot', () => {
    const live = liveCallsigns(feed('stale', [{ callsign: pair[0]!, seenAt: S('2026-10-02T02:37:00Z') }]), NOW);
    expect(live.seen.size).toBe(0);
    expect(live.state).toBe('stale');
    expect(live.run.status).toMatchObject({ ok: false, error: 'stale_snapshot' });
    expect(knownServices(lhr, jfk, live, NOW).some((s) => s.live || s.observedAt)).toBe(false);
  });

  it('caps the generic state with honestFlights: failing tile sweep beyond 360 s → stale', () => {
    const providers: Providers = { adsblol_tiles: { ok: false, count: 0, ms: 0, age_s: 400, error: 'http' } };
    const live = liveCallsigns(feed('live', [{ callsign: pair[0]!, seenAt: S('2026-10-02T02:48:50Z') }], providers), NOW);
    expect(live.state).toBe('stale');
    expect(live.run.status.ok).toBe(false);
  });

  it('LIVE only within the observation cadence; older records carry observedAt but not live', () => {
    const live = liveCallsigns(
      feed('live', [
        { callsign: pair[0]!, seenAt: S('2026-10-02T02:48:40Z') }, // 20 s
        { callsign: pair[1]!, seenAt: S('2026-10-02T02:45:00Z') }, // 240 s: RECENT, not LIVE
      ]),
      NOW,
    );
    expect(live.run.status.ok).toBe(true);
    const services = knownServices(lhr, jfk, live, NOW);
    const a = services.find((s) => s.callsign === pair[0])!;
    const b = services.find((s) => s.callsign === pair[1])!;
    expect(a.live).toBe(true);
    expect(a.observedAt).toBe('2026-10-02T02:48:40.000Z');
    expect(b.live).toBe(false);
    expect(b.observedAt).toBe('2026-10-02T02:45:00.000Z');
  });

  it('a RECENT snapshot never yields live:true, even for a fresh record', () => {
    const live = liveCallsigns(feed('recent', [{ callsign: pair[0]!, seenAt: S('2026-10-02T02:48:55Z') }]), NOW);
    expect(knownServices(lhr, jfk, live, NOW).find((s) => s.callsign === pair[0])!.live).toBe(false);
  });

  it('no feed / no snapshot → offline', () => {
    expect(liveCallsigns(undefined, NOW).run.status).toMatchObject({ ok: false, error: 'no_flights_feed' });
  });
});
