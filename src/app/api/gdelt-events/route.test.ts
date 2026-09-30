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
    expect(body.window).toEqual({ from: '2026-09-30T20:00:00.000Z', to: '2026-09-30T20:15:00.000Z', batches: 1 });
    expect(body.scanned).toBe(1233);
    expect(body.items.length).toBeGreaterThan(1100);
    expect(body.providers.export).toMatchObject({ ok: true });
    expect(body.meta).toMatchObject({ feed: 'gdelt-events', observedAt: '2026-09-30T20:00:00.000Z' });
    const zipCalls = state.calls.filter((c) => c.url.includes('.export.CSV.zip'));
    expect(zipCalls.length).toBe(4);
    expect(zipCalls.every((c) => c.url.startsWith('https://data.gdeltproject.org/gdeltv2/'))).toBe(true);
  });

  it('filters by QuadClass and limit, and validates the query', async () => {
    state.routes = [['lastupdate.txt', FX.gdeltLast], ['20260930200000.export', FX.gdeltZip], ['.export.CSV.zip', 404]];
    const body = await (await GET(req('/api/gdelt-events?quad=4&limit=50'), undefined)).json();
    expect(body.items).toHaveLength(50);
    expect(body.items.every((e: { quadClass: number }) => e.quadClass === 4)).toBe(true);
    expect((await GET(req('/api/gdelt-events?quad=7'), undefined)).status).toBe(400);
    expect((await GET(req('/api/gdelt-events?limit=9999'), undefined)).status).toBe(400);
  });

  it('answers 503 when GDELT is unreachable', async () => {
    state.routes = [['lastupdate.txt', 503]];
    const res = await GET(req('/api/gdelt-events'), undefined);
    expect(res.status).toBe(503);
    expect((await res.json()).providers.lastupdate).toMatchObject({ ok: false });
  });
});
