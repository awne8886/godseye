/**
 * GET /api/cloudflare-radar — Cloudflare Radar L3 attack ORIGIN shares (AttackOriginsResponse):
 * points only, arcs only when a target is reported. `?probe=1` answers whether it is configured.
 * Needs the `cloudflare` capability (CLOUDFLARE_API_TOKEN; off when COMMERCIAL_DEPLOYMENT=true).
 * Owner: layers-threats-network.
 */
import { z } from 'zod';
import { capabilityGate } from '@/features/network/server/gate';
import { attackOriginsFeed } from '@/features/network/server/outages';
import { evaluateCapability } from '@/lib/capabilities';
import { feedJson, json, parseQuery, withRoute } from '@/lib/respond';

export const dynamic = 'force-dynamic';

const Query = z.object({ probe: z.enum(['0', '1', 'true', 'false']).optional() });

export const GET = withRoute('/api/cloudflare-radar', async (req) => {
  const q = parseQuery(req, Query);
  if (!q.ok) return q.response;
  if (q.data.probe === '1' || q.data.probe === 'true') {
    const cap = evaluateCapability('cloudflare');
    return json({ configured: cap.enabled, reason: cap.reason, timestamp: new Date().toISOString(), providers: {} }, { ttl: 60 });
  }
  const gated = capabilityGate('cloudflare', 'cloudflare');
  if (gated) return gated;
  return feedJson(req, await attackOriginsFeed.get(), (d) => ({ items: d.items, window: d.window }));
});
