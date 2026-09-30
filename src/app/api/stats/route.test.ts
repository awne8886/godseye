import { describe, expect, it, vi } from 'vitest';

const feeds = [
  { key: 'earthquakes', health: () => ({ lastGoodAt: 1, count: 12 }) },
  { key: 'cctv:uk', health: () => ({ lastGoodAt: 1, count: 30 }) },
  { key: 'cctv:us-west', health: () => ({ lastGoodAt: 1, count: 70 }) },
  { key: 'cctv:asia', health: () => ({ lastGoodAt: null, count: 0 }) },
  { key: 'flights', health: () => ({ lastGoodAt: null, count: 0 }) },
];
vi.mock('@/server/feeds', () => ({ ALL_FEEDS: [] }));
vi.mock('@/lib/feeds', () => ({ allFeeds: () => feeds }));

describe('/api/stats', () => {
  it('reports null for feeds that never answered and sums camera regions', async () => {
    const { GET } = await import('./route');
    const body = await (await GET(new Request('http://x/api/stats'), undefined)).json();
    expect(body.counts).toMatchObject({ earthquakes: 12, flights: null, 'cctv:asia': null, cameras: 100 });
  });
});
