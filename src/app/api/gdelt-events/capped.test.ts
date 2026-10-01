/**
 * R3 round-5 MINOR-3, the busy-hour case: when the 1 h window holds more geocoded events than the
 * feed keeps (MAX_EVENTS, newest first), /api/gdelt-events reports the window's count and
 * `truncated: true` even when every kept event is served. Events: the recorded 2026-09-30 20:00
 * batch; the window count is what the aggregation would report for a busier hour. No network.
 */
import { describe, expect, it, vi } from 'vitest';
import { GdeltEventsResponse } from '@/lib/schemas';
import { fixture, FX } from '@/features/threats/server/__fixtures__';
import { parseExport } from '@/features/threats/server/gdelt';
import type * as Gdelt from '@/features/threats/server/gdelt';
import { unzipFirst } from '@/features/threats/server/zip';

const feedGet = vi.fn();
vi.mock('@/features/threats/server/gdelt', async (orig) => {
  const actual = await orig<typeof Gdelt>();
  return { ...actual, gdeltFeed: { get: () => feedGet() } };
});

const events = parseExport(unzipFirst(fixture(FX.gdeltZip)).data.toString('utf8')).events;
const at = '2026-09-30T20:00:00.000Z';
const snapshot = (windowEvents: number) => ({
  data: { items: events, windowEvents, window: { from: '2026-09-30T19:40:39.000Z', to: '2026-09-30T19:55:39.000Z', batches: 1 }, scanned: 1233 },
  meta: { feed: 'gdelt-events', kind: 'live', fetchedAt: at, observedAt: '2026-09-30T19:55:39.000Z', state: 'live', stale: false, ttlSeconds: 900, lastGoodAt: at, attribution: [] },
  providers: { lastupdate: { ok: true, count: 1, ms: 1, age_s: 0 }, export: { ok: true, count: events.length, ms: 1, age_s: 0 } },
});
let n = 0;
const req = (q: string) => new Request(`http://localhost/api/gdelt-events${q}`, { headers: { 'x-forwarded-for': `198.51.100.${++n % 250}` } });

describe('/api/gdelt-events when the feed capped the window', () => {
  it('reports the window count and truncated, even with every kept event served', async () => {
    feedGet.mockResolvedValue(snapshot(events.length + 400));
    const { GET } = await import('./route');
    const body = await (await GET(req('?limit=5000'), undefined as never)).json();
    expect(GdeltEventsResponse.safeParse(body).success).toBe(true);
    expect(body.items).toHaveLength(events.length);
    expect(body.total).toBe(events.length + 400);
    expect(body.truncated).toBe(true);
    expect(body.providers.export.ok).toBe(true);
    expect(body.meta.feed).toBe('gdelt-events');
  });

  it('a filtered query over a capped window counts what was kept and still says truncated', async () => {
    feedGet.mockResolvedValue(snapshot(events.length + 400));
    const { GET } = await import('./route');
    const body = await (await GET(req('?quad=1&limit=5000'), undefined as never)).json();
    expect(body.total).toBe(events.filter((e) => e.quadClass === 1).length);
    expect(body.items).toHaveLength(body.total);
    expect(body.truncated).toBe(true);
  });

  it('an uncapped window served whole is not truncated', async () => {
    feedGet.mockResolvedValue(snapshot(events.length));
    const { GET } = await import('./route');
    const body = await (await GET(req('?limit=5000'), undefined as never)).json();
    expect(body).toMatchObject({ total: events.length, truncated: false });
  });
});
