/** r8 MINOR: a failed refetch with retained data must own the chip and be labelled; pure helpers. */
import { describe, expect, it } from 'vitest';
import type { FeedMeta } from '@/lib/types';
import { feedChip } from './event-time';
import { FeedOfflineError } from './client';
import { failureChip, failureText, queryFailure } from './query-state';
import { graphChip, graphFailure } from '../graph/graph-status';

const NOW = Date.parse('2026-10-02T10:30:00Z');
const meta = (lastGoodAt: string | null): FeedMeta => ({ feed: 'news', kind: 'live', state: 'offline', fetchedAt: null, observedAt: null, lastGoodAt, stale: true, ttlSeconds: 60, attribution: [] });
const retainedCopy = { meta: { fetchedAt: '2026-10-02T10:12:00.000Z' } };
const at = (d: { meta: { fetchedAt: string | null } }) => d.meta.fetchedAt;

describe('queryFailure', () => {
  it('is null while healthy, even with data', () => {
    expect(queryFailure({ data: retainedCopy, error: null }, at)).toBeNull();
    expect(queryFailure({ data: undefined, error: null }, at)).toBeNull();
  });

  it('a 503 after a good fetch: retained, with the retained copy’s own fetch time', () => {
    const f = queryFailure({ data: retainedCopy, error: new FeedOfflineError(503, meta('2026-10-02T09:00:00.000Z'), null) }, at);
    expect(f).toEqual({ retained: true, status: 503, lastGoodAt: '2026-10-02T10:12:00.000Z' });
    expect(failureChip(f!, 'no channel or wire answered', NOW)).toMatchObject({ text: 'SOURCE OFFLINE · 10:12Z', tone: 'error' });
    expect(failureText(f!, 'no channel or wire answered', NOW)).toBe('SOURCE OFFLINE — no channel or wire answered; showing the last copy received, fetched 10:12 UTC.');
  });

  it('a network error (no HTTP answer) is a failure too, described as such', () => {
    const f = queryFailure({ data: retainedCopy, error: new TypeError('Failed to fetch') }, at)!;
    expect(f).toEqual({ retained: true, status: null, lastGoodAt: '2026-10-02T10:12:00.000Z' });
    expect(failureChip(f, 'no channel or wire answered', NOW).tone).toBe('error');
    expect(failureText(f, 'no channel or wire answered', NOW)).toMatch(/^SOURCE OFFLINE — this server did not answer; showing the last copy/);
  });

  it('without retained data it uses the server’s last-good time', () => {
    const f = queryFailure({ data: undefined, error: new FeedOfflineError(503, meta('2026-10-01T23:05:00.000Z'), null) }, at)!;
    expect(f).toEqual({ retained: false, status: 503, lastGoodAt: '2026-10-01T23:05:00.000Z' });
    expect(failureText(f, 'x', NOW)).toBe('SOURCE OFFLINE — x; last good 2026-10-01 23:05 UTC.');
    expect(failureChip(f, 'x', NOW).text).toBe('SOURCE OFFLINE · 2026-10-01 23:05Z');
    expect(failureChip({ retained: false, status: null, lastGoodAt: null }, 'x', NOW)).toMatchObject({ text: 'SOURCE OFFLINE', tone: 'error' });
  });

  it('names rate limiting and rejected requests for what they are', () => {
    expect(failureChip({ retained: true, status: 429, lastGoodAt: null }, 'x', NOW)).toMatchObject({ text: 'RATE LIMITED', tone: 'warn' });
    expect(failureText({ retained: false, status: 400, lastGoodAt: null }, 'x', NOW)).toBe('REQUEST REJECTED — the route answered HTTP 400.');
    expect(failureText({ retained: false, status: 500, lastGoodAt: null }, 'x', NOW)).toBe('SOURCE OFFLINE — the route answered HTTP 500.');
  });
});

describe('ENTITY GRAPH chip (same pattern: nodes kept after a failed expansion)', () => {
  it('names the failure instead of the kept node count', () => {
    const failure = graphFailure(new FeedOfflineError(503, null, null), NOW);
    expect(failure.message).toBe('SOURCE OFFLINE — no entity upstream answered.');
    const chip = graphChip({ busy: false, failure }, 12);
    expect(chip).toMatchObject({ text: 'SOURCE OFFLINE', tone: 'error' });
    expect(chip.title).toMatch(/12 nodes kept from earlier expansions/);
  });
  it('a network error and an invalid id are told apart', () => {
    expect(graphFailure(new TypeError('Failed to fetch'), NOW).message).toBe('SOURCE OFFLINE — this server did not answer.');
    expect(graphChip({ busy: false, failure: graphFailure(new FeedOfflineError(400, null, null), NOW) }, 3)).toMatchObject({ text: 'INVALID ID', tone: 'warn' });
  });
  it('is the count when healthy, STANDBY when empty, PLOTTING while busy', () => {
    expect(graphChip({ busy: false, failure: null }, 4)).toEqual({ text: '4 NODES', tone: 'live' });
    expect(graphChip({ busy: false, failure: null }, 0)).toEqual({ text: 'STANDBY', tone: 'idle' });
    expect(graphChip({ busy: true, failure: graphFailure(new TypeError('x')) }, 4)).toEqual({ text: 'PLOTTING', tone: 'busy' });
  });
});

describe('INTEL FEED chip (events retained from layers that went offline)', () => {
  const states: Record<string, string> = { alert_pins: 'offline', earthquakes: 'live', fires: 'stale' };
  const of = (l: string) => states[l];
  it('is SOURCE OFFLINE when every layer behind the rows is offline', () => {
    expect(feedChip(40, ['alert_pins'], of)).toMatchObject({ text: 'SOURCE OFFLINE', tone: 'error' });
  });
  it('keeps the count in the warning tone and names the offline/stale layers when some are', () => {
    const c = feedChip(90, ['alert_pins', 'earthquakes', 'fires'], of);
    expect(c.text).toBe('90 RESULTS');
    expect(c.tone).toBe('warn');
    expect(c.title).toMatch(/source offline: .*; stale: /);
  });
  it('is live only when the layers behind the rows are; feed-only layers do not count', () => {
    expect(feedChip(5, ['earthquakes', 'kev'], of)).toEqual({ text: '5 RESULTS', tone: 'live' });
    expect(feedChip(0, [], of)).toEqual({ text: 'STANDBY', tone: 'idle' });
  });
});
