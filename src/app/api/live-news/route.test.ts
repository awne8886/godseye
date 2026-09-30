import type * as Http from '@/lib/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { done, fresh, req } from '@/features/surveillance/server/__fixtures__/helpers';
import { LiveNewsResponse } from '@/lib/schemas/surveillance';

const state = vi.hoisted(() => ({ fail: false }));
vi.mock('@/lib/http', async (importOriginal) => {
  const orig = await importOriginal<typeof Http>();
  const { FX, text } = await import('@/features/surveillance/server/__fixtures__');
  return {
    ...orig,
    httpText: async (url: string) => {
      if (state.fail) throw new orig.HttpError('network', 'network', url);
      // Al Jazeera and C-SPAN pages recorded 2026-09-30 (live watch page / channel page); the rest unreadable.
      const name = url.includes('UCNye-wNBqNL5ZzHSJj3l8Bg') ? FX.ytLive : url.includes('UCb--64Gl51jIEVE-GLDAVTg') ? FX.ytChannel : FX.ytUnknown;
      return { status: 200, ok: true, notModified: false, headers: {}, body: Buffer.alloc(0), url, etag: null, lastModified: null, ms: 1, attempts: 1, text: text(name) };
    },
  };
});

const { GET } = await import('./route');
const { liveNewsFeed } = await import('@/features/surveillance/server/live-news');

beforeEach(() => {
  fresh();
  state.fail = false;
});
afterEach(() => {
  liveNewsFeed.stop();
  done();
});

describe('GET /api/live-news', () => {
  it('serves official channels with honest live flags (true / false / unknown)', async () => {
    const res = await GET(req('/api/live-news'), undefined);
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(LiveNewsResponse.safeParse(b).success).toBe(true);
    expect(b.meta).toMatchObject({ feed: 'live-news', kind: 'mixed' });
    expect(b.providers['youtube-live-check']).toMatchObject({ ok: true, count: 2 });
    const byId = Object.fromEntries(b.items.map((c: { id: string }) => [c.id, c]));
    expect(byId.aljazeera).toMatchObject({ live: true, embedAllowed: true, embedUrl: 'https://www.youtube-nocookie.com/embed/live_stream?channel=UCNye-wNBqNL5ZzHSJj3l8Bg' });
    expect(byId.cspan).toMatchObject({ live: false, embedAllowed: false, embedUrl: null, externalUrl: 'https://www.youtube.com/channel/UCb--64Gl51jIEVE-GLDAVTg/live' });
    expect(byId.cbc.live).toBeNull();
    expect(b.items.some((c: { id: string }) => c.id === 'rt')).toBe(false);
  });

  it('when YouTube cannot be reached the list is still served, every live flag unknown and the check marked failed', async () => {
    state.fail = true;
    const b = await (await GET(req('/api/live-news'), undefined)).json();
    expect(LiveNewsResponse.safeParse(b).success).toBe(true);
    expect(b.items.every((c: { live: unknown }) => c.live === null)).toBe(true);
    expect(b.providers['youtube-live-check']).toMatchObject({ ok: false, count: 0 });
  });
});
