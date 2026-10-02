import type * as Http from '@/lib/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAPTURED_AT, HAPPY, type Call, type Route } from '../__fixtures__';
import { freshCache, resetCache } from '../__fixtures__/routes';
import { newsFeed } from '../feeds';
import { runNews, TG_CHANNEL_TTL_MS, TELEGRAM_CHANNELS, WIRE_TTL_MS } from './news';

const state = vi.hoisted(() => ({ routes: [] as Route[], calls: [] as Call[] }));
vi.mock('@/lib/http', async (importOriginal) => {
  const orig = await importOriginal<typeof Http>();
  const { httpMock } = await import('../__fixtures__');
  return { ...orig, ...httpMock(() => state.routes, orig.HttpError, state.calls) };
});

const calls = (needle: string) => state.calls.filter((c) => c.url.includes(needle)).length;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: CAPTURED_AT });
  freshCache();
  state.routes = HAPPY;
  state.calls.length = 0;
});
afterEach(() => {
  newsFeed.stop();
  resetCache();
  vi.useRealTimers();
});

describe('news per-source caches (Telegram 3 min, wire 2 min, feed rebuild 60 s)', () => {
  it('declares the cadences', () => {
    expect(TG_CHANNEL_TTL_MS).toBe(180_000);
    expect(WIRE_TTL_MS).toBe(120_000);
    expect(newsFeed.def.ttlMs).toBe(60_000);
    expect(newsFeed.def.pollMs).toBe(60_000);
  });

  it('two runs 70 s apart fetch each channel once; the second run reports the cache age', async () => {
    const first = await runNews(undefined, Date.now());
    for (const ch of TELEGRAM_CHANNELS) expect(calls(`t.me/s/${ch.handle}`)).toBe(1);
    expect(calls('feeds.bbci.co.uk')).toBe(1);
    expect(first.providers['tg:Osintdefender']).toMatchObject({ status: { ok: true }, okAt: CAPTURED_AT });

    vi.setSystemTime(CAPTURED_AT + 70_000);
    const second = await runNews(undefined, Date.now());
    expect(calls('t.me/s/Osintdefender')).toBe(1);
    expect(calls('t.me/s/rybar_in_english')).toBe(1);
    expect(calls('feeds.bbci.co.uk')).toBe(1);
    expect(second.providers['tg:Osintdefender']!.okAt).toBe(CAPTURED_AT);
    expect(second.data.items.filter((i) => i.source === 't.me/Osintdefender').length).toBe(first.data.items.filter((i) => i.source === 't.me/Osintdefender').length);
    // A channel that failed (no recorded page → network error) is retried after the 60 s back-off.
    expect(calls('t.me/s/WarMonitors')).toBe(2);
    expect(second.providers['tg:WarMonitors']).toMatchObject({ status: { ok: false, count: 0, error: 'network' }, okAt: null });

    vi.setSystemTime(CAPTURED_AT + 130_000);
    await runNews(undefined, Date.now());
    expect(calls('feeds.bbci.co.uk')).toBe(2);
    expect(calls('t.me/s/Osintdefender')).toBe(1);
  });

  it('refetches after 3 min and keeps last-good posts with ok:false when the channel fails', async () => {
    const first = await runNews(undefined, Date.now());
    const good = first.data.items.filter((i) => i.source === 't.me/Osintdefender').length;
    expect(good).toBeGreaterThan(0);

    state.routes = [['t.me/s/Osintdefender', 503], ...HAPPY];
    vi.setSystemTime(CAPTURED_AT + TG_CHANNEL_TTL_MS + 1000);
    const later = await runNews(undefined, Date.now());
    expect(calls('t.me/s/Osintdefender')).toBe(2);
    expect(later.providers['tg:Osintdefender']).toMatchObject({ status: { ok: false, count: good, error: 'http_503' }, okAt: CAPTURED_AT });
    expect(later.data.items.filter((i) => i.source === 't.me/Osintdefender').length).toBe(good);
    expect(later.data.sources.find((s) => s.handle === 'Osintdefender')).toMatchObject({ ok: false, count: good });
  });

  it('the feed response reports age_s from the channel cache, not from the 60 s rebuild', async () => {
    await newsFeed.refresh({ force: true });
    vi.setSystemTime(CAPTURED_AT + 70_000);
    const r = await newsFeed.refresh({ force: true });
    expect(calls('t.me/s/Osintdefender')).toBe(1);
    expect(r.providers['tg:Osintdefender']).toMatchObject({ ok: true, age_s: 70 });
  });
});
