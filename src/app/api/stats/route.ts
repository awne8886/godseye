/**
 * GET /api/stats — entity counts per feed (counts only, no data). A feed that never produced a
 * snapshot reports null rather than 0. Camera regions (`cctv:<region>`) are also summed under
 * `cameras` (null until at least one region has answered). Owner: lead.
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
  const regions = Object.entries(counts).filter(([k, v]) => k.startsWith('cctv:') && v !== null);
  counts.cameras = regions.length ? regions.reduce((n, [, v]) => n + (v ?? 0), 0) : null;
  return json({ counts, timestamp: new Date().toISOString() } satisfies StatsResponse, { ttl: 30 });
});
