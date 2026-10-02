/**
 * /api/conflicts counts Live Alert pins inside zones (TODO L121). The conflicts feed reads the news
 * feed in-process (newsFeed.get(), never the /api/news route); here that read returns the recorded
 * news snapshot (runNews() output captured 2026-10-02) and GDELT is served from its recorded batch.
 */
import type * as Http from '@/lib/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newsFeed } from '@/components/panels/intel/feeds';
import { fixture, FX, type Route } from '@/features/threats/server/__fixtures__';
import { freshCache, req, resetCache } from '@/features/threats/server/__fixtures__/routes';
import { conflictsFeed, resetConflictBuffer } from '@/features/threats/server/conflicts';
import { gdeltFeed, resetGdeltBatches } from '@/features/threats/server/gdelt';
import type { FeedResult } from '@/lib/feeds';
import { ConflictsResponse } from '@/lib/schemas';
import type { AlertItem, ConflictEvent } from '@/lib/types';
import { GET } from './route';

const state = vi.hoisted(() => ({ routes: [] as Route[] }));
vi.mock('@/lib/http', async (importOriginal) => {
  const orig = await importOriginal<typeof Http>();
  const { httpMock } = await import('@/features/threats/server/__fixtures__');
  return { ...orig, ...httpMock(() => state.routes, orig.HttpError) };
});

const recorded = JSON.parse(fixture(FX.news).toString('utf8')) as { _meta: { capturedAt: string }; items: AlertItem[] };
const NOW = Date.parse(recorded._meta.capturedAt);

type News = Awaited<ReturnType<typeof newsFeed.get>>;
function newsResult(stateName: 'live' | 'offline'): News {
  const at = new Date(NOW - 60_000).toISOString();
  const live = stateName === 'live';
  return {
    data: live ? { items: recorded.items, sources: [] } : null,
    meta: { feed: 'news', kind: 'live', state: stateName, fetchedAt: live ? at : null, observedAt: live ? recorded.items[0]!.publishedAt : null, lastGoodAt: live ? at : null, stale: !live, ttlSeconds: 120, attribution: [] },
    providers: {},
  } as FeedResult<News['data'] & object> as News;
}

beforeEach(() => {
  freshCache();
  resetGdeltBatches();
  resetConflictBuffer();
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  state.routes = [['lastupdate.txt', 503]];
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  gdeltFeed.stop();
  conflictsFeed.stop();
  resetCache();
});

describe('GET /api/conflicts with Live Alerts', () => {
  it('counts in-zone alert pins at their own coordinates and reports providers.alerts', async () => {
    const spy = vi.spyOn(newsFeed, 'get').mockResolvedValue(newsResult('live'));
    const res = await GET(req('/api/conflicts'), undefined);
    expect(spy).toHaveBeenCalled();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(ConflictsResponse.safeParse(body).success).toBe(true);
    expect(body.meta.feed).toBe('conflicts');
    const alerts = (body.events as ConflictEvent[]).filter((e) => e.source === 'alerts');
    expect(alerts.length).toBe(6);
    expect(body.providers.alerts).toMatchObject({ ok: true, count: 6 });
    // GDELT is down here: its provider says so and counts none.
    expect(body.providers.gdelt).toMatchObject({ ok: false, count: 0 });
    const src = new Map(recorded.items.map((i) => [`alert:${i.id}`, i]));
    for (const e of alerts) {
      expect([e.lng, e.lat]).toEqual([src.get(e.id)!.place!.lng, src.get(e.id)!.place!.lat]);
      expect(e.url).toBe(src.get(e.id)!.link);
    }
    const total = body.zones.reduce((n: number, z: { liveEventCount: number }) => n + z.liveEventCount, 0);
    expect(total).toBe(body.events.length);
    expect(body.zones.find((z: { id: string }) => z.id === 'ukraine').liveEventCount).toBe(3);
    expect(body.zones.find((z: { id: string }) => z.id === 'gaza').liveEventCount).toBe(2);
  });

  it('still serves the REFERENCE zones when the news feed is offline, reporting it', async () => {
    vi.spyOn(newsFeed, 'get').mockResolvedValue(newsResult('offline'));
    const res = await GET(req('/api/conflicts'), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(ConflictsResponse.safeParse(body).success).toBe(true);
    expect(body.zones).toHaveLength(15);
    expect(body.events).toEqual([]);
    expect(body.providers.alerts).toMatchObject({ ok: false, count: 0, error: 'offline' });
  });
});
