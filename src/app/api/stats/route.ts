/**
 * GET /api/stats — entity counts per feed (counts only, no data). A feed that never produced a
 * snapshot reports null rather than 0. Owner: lead.
 */
import { ALL_FEEDS } from '@/server/feeds';
import { allFeeds } from '@/lib/feeds';
import { json, withRoute } from '@/lib/respond';
import type { StatsResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';

export const GET = withRoute('/api/stats', () => {
  void ALL_FEEDS;
  const counts: StatsResponse['counts'] = {};
  for (const f of allFeeds()) {
    const h = f.health();
    counts[f.key] = h.lastGoodAt === null ? null : h.count;
  }
  return json({ counts, timestamp: new Date().toISOString() } satisfies StatsResponse, { ttl: 30 });
});
