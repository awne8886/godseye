import type * as Http from '@/lib/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FX, type Route } from '@/features/threats/server/__fixtures__';
import { freshCache, req, resetCache } from '@/features/threats/server/__fixtures__/routes';
import { conflictsFeed, resetConflictBuffer } from '@/features/threats/server/conflicts';
import { gdeltFeed, resetGdeltBatches } from '@/features/threats/server/gdelt';
import { ConflictsResponse } from '@/lib/schemas';
import { GET } from './route';

const state = vi.hoisted(() => ({ routes: [] as Route[] }));
vi.mock('@/lib/http', async (importOriginal) => {
  const orig = await importOriginal<typeof Http>();
  const { httpMock } = await import('@/features/threats/server/__fixtures__');
  return { ...orig, ...httpMock(() => state.routes, orig.HttpError) };
});

beforeEach(() => {
  freshCache();
  resetGdeltBatches();
  resetConflictBuffer();
  vi.useFakeTimers({ now: Date.parse('2026-09-30T20:10:00Z'), toFake: ['Date'] });
});
afterEach(() => {
  vi.useRealTimers();
  gdeltFeed.stop();
  conflictsFeed.stop();
  resetCache();
});

describe('GET /api/conflicts', () => {
  it('serves 15 REFERENCE zones and in-zone GDELT events at their own coordinates', async () => {
    state.routes = [['lastupdate.txt', FX.gdeltLast], ['20260930200000.export', FX.gdeltZip], ['.export.CSV.zip', 404]];
    const res = await GET(req('/api/conflicts'), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(ConflictsResponse.safeParse(body).success).toBe(true);
    expect(body.zones).toHaveLength(15);
    expect(body.zones.every((z: { kind: string }) => z.kind === 'reference')).toBe(true);
    expect(body.providers.gdelt.ok).toBe(true);
    expect(body.providers.zones).toMatchObject({ ok: true, count: 15 });
    const total = body.zones.reduce((n: number, z: { liveEventCount: number }) => n + z.liveEventCount, 0);
    expect(total).toBe(body.events.length);
    // Each event keeps the GDELT row's coordinates: no two events are nudged apart around an anchor.
    const gd = await gdeltFeed.get();
    const byId = new Map(gd.data!.items.map((e) => [e.id, e]));
    for (const ev of body.events) expect([ev.lng, ev.lat]).toEqual([byId.get(ev.id)!.lng, byId.get(ev.id)!.lat]);
  });

  it('still serves the reference zones when GDELT is down, reporting it', async () => {
    state.routes = [['lastupdate.txt', 503]];
    const res = await GET(req('/api/conflicts'), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.zones).toHaveLength(15);
    expect(body.events).toEqual([]);
    expect(body.providers.gdelt).toMatchObject({ ok: false });
  });
});
