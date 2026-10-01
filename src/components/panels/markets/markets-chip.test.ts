import { describe, expect, it } from 'vitest';
import { holidaysModelled, isOpen, nextChange, sessionsAt, EXCHANGES } from '../intel/server/sessions';
import { marketsChip } from './markets-chip';

const q = (group: 'indices' | 'crypto', unofficial: boolean) => ({ symbol: 'X', name: 'X', group, price: 1, changePct: 0, currency: 'USD', spark: [], marketOpen: null, observedAt: null, source: 'yahoo', unofficial });
const meta = (state: 'live' | 'stale') => ({ state }) as never;
const ex = (name: string) => EXCHANGES.find((e) => e.exchange === name)!;

describe('MARKETS chip (visual-qa M6)', () => {
  it('is CLOSED when every session is closed, even with live crypto', () => {
    const at = Date.parse('2026-10-03T12:00:00Z'); // Saturday
    expect(marketsChip({ meta: meta('live'), sessions: sessionsAt(at), quotes: [q('indices', true), q('crypto', false)] })).toEqual({ text: 'CLOSED', tone: 'idle' });
  });
  it('is DELAYED while sessions are open and index quotes come from the unofficial Yahoo endpoint', () => {
    const at = Date.parse('2026-09-30T14:00:00Z'); // NYSE open
    expect(marketsChip({ meta: meta('live'), sessions: sessionsAt(at), quotes: [q('indices', true), q('crypto', false)] }).text).toBe('DELAYED');
    expect(marketsChip({ meta: meta('live'), sessions: sessionsAt(at), quotes: [q('crypto', false)] }).text).toBe('DELAYED');
  });
  it('is LIVE only when every exchange quote is official, and reports a non-live feed state', () => {
    const at = Date.parse('2026-09-30T14:00:00Z');
    expect(marketsChip({ meta: meta('live'), sessions: sessionsAt(at), quotes: [q('indices', false)] })).toEqual({ text: 'LIVE', tone: 'live' });
    expect(marketsChip({ meta: meta('stale'), sessions: sessionsAt(at), quotes: [q('indices', false)] }).text).toBe('STALE');
  });
});

describe('MARKETS chip with Yahoo offline (R3 round-4 MAJOR-2)', () => {
  const at = Date.parse('2026-10-01T14:00:00Z'); // NYSE open
  const prov = (ok: boolean) => ({ yahoo: { ok, count: ok ? 26 : 0, ms: 5, age_s: 600, ...(ok ? {} : { error: 'http_429' }) } });
  it('reads SOURCE OFFLINE with the same-day last-good time, never DELAYED', () => {
    const kept = { ...q('indices', true), lastGoodAt: '2026-10-01T13:50:00.000Z' };
    const chip = marketsChip({ meta: meta('live'), sessions: sessionsAt(at), quotes: [kept, q('crypto', false)], providers: prov(false) }, at);
    expect(chip).toEqual({ text: 'SOURCE OFFLINE · 13:50Z', tone: 'error', title: 'Yahoo chart endpoint offline (http_429) — last good 13:50 UTC' });
  });
  it('reads SOURCE OFFLINE without a time when Yahoo never answered', () => {
    expect(marketsChip({ meta: meta('live'), sessions: sessionsAt(at), quotes: [q('crypto', false)], providers: prov(false) }, at)).toMatchObject({ text: 'SOURCE OFFLINE', tone: 'error' });
  });
  it('keeps DELAYED when Yahoo answered', () => {
    expect(marketsChip({ meta: meta('live'), sessions: sessionsAt(at), quotes: [q('indices', true)], providers: prov(true) }, at).text).toBe('DELAYED');
  });
});

describe('exchange holidays (R3-m6)', () => {
  it('closes SSE for Golden Week and HKEX on National Day; reopening is found after the break', () => {
    const oct1 = Date.parse('2026-10-01T02:00:00Z'); // 10:00 Shanghai / Hong Kong, a Thursday
    expect(isOpen(ex('SSE'), oct1)).toBe(false);
    expect(isOpen(ex('HKEX'), oct1)).toBe(false);
    expect(isOpen(ex('TSE'), oct1)).toBe(true);
    expect(new Date(nextChange(ex('SSE'), Date.parse('2026-09-30T08:00:00Z'))!).toISOString()).toBe('2026-10-08T01:30:00.000Z');
    expect(new Date(nextChange(ex('HKEX'), Date.parse('2026-09-30T08:00:00Z'))!).toISOString()).toBe('2026-10-02T01:30:00.000Z');
  });
  it('closes NYSE on Thanksgiving and LSE on the Boxing Day substitute', () => {
    expect(isOpen(ex('NYSE'), Date.parse('2026-11-26T15:00:00Z'))).toBe(false);
    expect(isOpen(ex('NYSE'), Date.parse('2026-11-27T15:00:00Z'))).toBe(true);
    expect(isOpen(ex('LSE'), Date.parse('2026-12-28T10:00:00Z'))).toBe(false);
  });
  it('says which exchanges have a sourced calendar for the year', () => {
    const at = Date.parse('2026-09-30T12:00:00Z');
    expect(holidaysModelled(ex('NYSE'), at)).toBe(true);
    expect(holidaysModelled(ex('TSE'), at)).toBe(false);
    expect(holidaysModelled(ex('NYSE'), Date.parse('2027-01-05T12:00:00Z'))).toBe(false);
    expect(sessionsAt(at).filter((s) => s.holidaysModelled).map((s) => s.exchange)).toEqual(['NYSE', 'NASDAQ', 'LSE', 'SSE', 'HKEX']);
  });
});
