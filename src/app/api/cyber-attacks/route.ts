/**
 * GET /api/cyber-attacks — Feodo Tracker botnet C2 INDICATORS (C2Response), never arcs. Reports how
 * many C2s Feodo currently lists online (honestly 0 or 1 at times). Needs `nc_sources`.
 * Owner: layers-threats-network.
 */
import { c2Feed } from '@/features/network/server/abusech';
import { capabilityGate } from '@/features/network/server/gate';
import { feedJson, withRoute } from '@/lib/respond';

export const dynamic = 'force-dynamic';

export const GET = withRoute('/api/cyber-attacks', async (req) => {
  const gated = capabilityGate('nc_sources', 'feodo');
  if (gated) return gated;
  return feedJson(req, await c2Feed.get(), (d) => ({ items: d.items, onlineCount: d.onlineCount, unlocated: d.unlocated }));
});
