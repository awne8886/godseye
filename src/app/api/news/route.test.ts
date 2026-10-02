import type * as Http from '@/lib/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAPTURED_AT, HAPPY, type Route } from '@/components/panels/intel/__fixtures__';
import { freshCache, req, resetCache } from '@/components/panels/intel/__fixtures__/routes';
import { newsFeed } from '@/components/panels/intel/feeds';
import { NewsResponse } from '@/lib/schemas/intel';
import { GET } from './route';

const state = vi.hoisted(() => ({ routes: [] as Route[] }));
vi.mock('@/lib/http', async (importOriginal) => {
  const orig = await importOriginal<typeof Http>();
  const { httpMock } = await import('@/components/panels/intel/__fixtures__');
  return { ...orig, ...httpMock(() => state.routes, orig.HttpError) };
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: CAPTURED_AT });
  freshCache();
});
afterEach(() => {
  newsFeed.stop();
  resetCache();
  vi.useRealTimers();
});

describe('GET /api/news', () => {
  it('serves plain-text alerts with stance, pins and per-source status (ToI/TASS offline, not hidden)', async () => {
    state.routes = HAPPY;
    const res = await GET(req('/api/news'), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    const parsed = NewsResponse.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(body.meta).toMatchObject({ feed: 'news', kind: 'live' });
    expect(body.providers['tg:Osintdefender']).toMatchObject({ ok: true });
    expect(body.providers['rss:bbc']).toMatchObject({ ok: true });
    expect(body.providers['rss:timesofisrael']).toMatchObject({ ok: false, error: 'http_403' });
    expect(body.sources.find((s: { handle: string }) => s.handle === 'tass')).toMatchObject({ ok: false, count: 0 });
    expect(body.sources).toHaveLength(21);
    for (const it of body.items) {
      expect(it.link).toMatch(/^https?:\/\//);
      expect(`${it.title} ${it.summary ?? ''}`).not.toMatch(/<\/?(a|b|i|div|span|br)\b/i);
    }
    const pinned = body.items.filter((i: { place: unknown }) => i.place);
    expect(pinned.length).toBeGreaterThan(0);
    // Newest first.
    const times = body.items.map((i: { publishedAt: string }) => Date.parse(i.publishedAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('filters by kind and bloc and rejects unknown values', async () => {
    state.routes = HAPPY;
    const res = await GET(req('/api/news?bloc=russian'), undefined);
    const body = await res.json();
    expect(body.items.every((i: { bloc: string }) => i.bloc === 'russian')).toBe(true);
    expect((await GET(req('/api/news?kind=gossip'), undefined)).status).toBe(400);
  });

  it('answers 503 SOURCE OFFLINE when every source fails', async () => {
    state.routes = [];
    const res = await GET(req('/api/news'), undefined);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('source_offline');
    expect(body.meta.state).toBe('offline');
    expect(body.providers['tg:Osintdefender']).toMatchObject({ ok: false, error: 'network' });
  });
});
