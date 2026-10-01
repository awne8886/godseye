import type * as Http from '@/lib/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FX, type Call, type Route } from '@/features/threats/server/__fixtures__';
import { freshCache, req, resetCache } from '@/features/threats/server/__fixtures__/routes';
import { gdeltFeed, resetGdeltBatches } from '@/features/threats/server/gdelt';
import { GdeltEventsResponse } from '@/lib/schemas';
import { GET } from './route';

const state = vi.hoisted(() => ({ routes: [] as Route[], calls: [] as Call[] }));
vi.mock('@/lib/http', async (importOriginal) => {
  const orig = await importOriginal<typeof Http>();
  const { httpMock } = await import('@/features/threats/server/__fixtures__');
  return { ...orig, ...httpMock(() => state.routes, orig.HttpError, state.calls) };
});

beforeEach(() => {
  freshCache();
  resetGdeltBatches();
  state.calls.length = 0;
});
afterEach(() => {
  gdeltFeed.stop();
  resetCache();
});

describe('GET /api/gdelt-events', () => {
  it('fetches the export over https and serves geocoded events with the window', async () => {
    // Only the newest batch is recorded; older windows 404 and are skipped (not required).
    state.routes = [['lastupdate.txt', FX.gdeltLast], ['20260930200000.export', FX.gdeltZip], ['.export.CSV.zip', 404]];
    const res = await GET(req('/api/gdelt-events?limit=2000'), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(GdeltEventsResponse.safeParse(body).success).toBe(true);
    // The recorded zip answers Last-Modified 19:55:39 for batch label 20:00: the window ends at the
    // observed publish time, not at the (later) label.
    expect(body.window).toEqual({ from: '2026-09-30T19:40:39.000Z', to: '2026-09-30T19:55:39.000Z', batches: 1, latestLabel: '2026-09-30T20:00:00.000Z' });
    expect(body.scanned).toBe(1233);
    expect(body.items.length).toBeGreaterThan(1100);
    // Everything in the window was served, and the response says so.
    expect(body.total).toBe(body.items.length);
    expect(body.truncated).toBe(false);
    expect(body.providers.export).toMatchObject({ ok: true });
    expect(body.meta).toMatchObject({ feed: 'gdelt-events', observedAt: '2026-09-30T19:55:39.000Z' });
    const zipCalls = state.calls.filter((c) => c.url.includes('.export.CSV.zip'));
    expect(zipCalls.length).toBe(4);
    expect(zipCalls.every((c) => c.url.startsWith('https://data.gdeltproject.org/gdeltv2/'))).toBe(true);
  });

  // R3 round-4 MINOR-4: live, meta.observedAt read 05:30:00 on a snapshot fetched at 05:28:55
  // (GDELT labels a batch ~10 min ahead of publishing it).
  it('never stamps an observation after the fetch, even when GDELT’s label is in the future', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-09-30T19:52:00Z'), toFake: ['Date'] });
    try {
      state.routes = [['lastupdate.txt', FX.gdeltLast], ['20260930200000.export', FX.gdeltZip], ['.export.CSV.zip', 404]];
      const body = await (await GET(req('/api/gdelt-events?limit=2000'), undefined)).json();
      expect(GdeltEventsResponse.safeParse(body).success).toBe(true);
      const fetchedAt = Date.parse(body.meta.fetchedAt);
      expect(fetchedAt).toBe(Date.parse('2026-09-30T19:52:00Z'));
      expect(Date.parse(body.meta.observedAt)).toBeLessThanOrEqual(fetchedAt);
      expect(Date.parse(body.window.to)).toBeLessThanOrEqual(fetchedAt);
      expect(body.window.latestLabel).toBe('2026-09-30T20:00:00.000Z');
      expect(body.items.every((e: { dateAdded: string }) => Date.parse(e.dateAdded) <= fetchedAt)).toBe(true);
      expect(body.providers.lastupdate).toMatchObject({ ok: true });
      expect(body.providers.export).toMatchObject({ ok: true });
      expect(body.meta.state).toBe('live');
    } finally {
      vi.useRealTimers();
    }
  });

  it('filters by QuadClass and limit, and validates the query', async () => {
    state.routes = [['lastupdate.txt', FX.gdeltLast], ['20260930200000.export', FX.gdeltZip], ['.export.CSV.zip', 404]];
    const body = await (await GET(req('/api/gdelt-events?quad=4&limit=50'), undefined)).json();
    expect(GdeltEventsResponse.safeParse(body).success).toBe(true);
    expect(body.items).toHaveLength(50);
    expect(body.items.every((e: { quadClass: number }) => e.quadClass === 4)).toBe(true);
    expect((await GET(req('/api/gdelt-events?quad=7'), undefined)).status).toBe(400);
    expect((await GET(req('/api/gdelt-events?limit=9999'), undefined)).status).toBe(400);
    expect((await GET(req('/api/gdelt-events?limit=5001'), undefined)).status).toBe(400);
  });

  // R3 round-5 MINOR-3: the default limit served the first 1 000 of 4 247 events with no hint.
  it('never truncates silently: total and truncated describe what was left out', async () => {
    state.routes = [['lastupdate.txt', FX.gdeltLast], ['20260930200000.export', FX.gdeltZip], ['.export.CSV.zip', 404]];
    const all = await (await GET(req('/api/gdelt-events?limit=5000'), undefined)).json();
    expect(all.truncated).toBe(false);
    expect(all.total).toBe(all.items.length);
    expect(all.total).toBeGreaterThan(1000);
    // The default limit (1 000) is a slice of the window and says so.
    const def = await (await GET(req('/api/gdelt-events'), undefined)).json();
    expect(GdeltEventsResponse.safeParse(def).success).toBe(true);
    expect(def.items).toHaveLength(1000);
    expect(def.total).toBe(all.total);
    expect(def.truncated).toBe(true);
    // The slice is the newest events (the order the feed keeps).
    expect(def.items.map((e: { id: string }) => e.id)).toEqual(all.items.slice(0, 1000).map((e: { id: string }) => e.id));
    // With a QuadClass filter, total counts the matching events.
    const q4 = await (await GET(req('/api/gdelt-events?quad=4&limit=50'), undefined)).json();
    expect(q4.total).toBe(all.items.filter((e: { quadClass: number }) => e.quadClass === 4).length);
    expect(q4.truncated).toBe(q4.total > 50);
  });

  it('answers 503 when GDELT is unreachable', async () => {
    state.routes = [['lastupdate.txt', 503]];
    const res = await GET(req('/api/gdelt-events'), undefined);
    expect(res.status).toBe(503);
    expect((await res.json()).providers.lastupdate).toMatchObject({ ok: false });
  });
});
