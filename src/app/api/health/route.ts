/**
 * GET /api/health — capability flags (the UI hides what is not configured), per-feed and
 * per-upstream status, geocoder queue stats and the snapshot store backend. No secrets.
 * Owner: lead.
 */
import { ALL_FEEDS } from '@/server/feeds';
import { APP_VERSION } from '@/lib/config';
import { evaluateCapabilities } from '@/lib/capabilities';
import { allFeeds } from '@/lib/feeds';
import { getStore } from '@/lib/cache';
import { geocoderStats } from '@/lib/geocode';
import { json, withRoute } from '@/lib/respond';
import type { HealthResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';

const started = Date.now();

export const GET = withRoute('/api/health', () => {
  void ALL_FEEDS; // importing registers every feed
  const feeds: HealthResponse['feeds'] = {};
  for (const f of allFeeds()) feeds[f.key] = f.health();
  const degraded = Object.values(feeds).some((f) => f.state === 'offline' || f.state === 'stale');
  const body: HealthResponse = {
    status: degraded ? 'degraded' : 'ok',
    version: APP_VERSION,
    uptimeS: Math.round((Date.now() - started) / 1000),
    capabilities: evaluateCapabilities(),
    feeds,
    geocoder: geocoderStats(),
    store: getStore().kind,
    timestamp: new Date().toISOString(),
  };
  return json(body, { ttl: 10 });
});
