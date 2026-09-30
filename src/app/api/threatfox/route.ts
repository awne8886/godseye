/**
 * GET /api/threatfox — ThreatFox recent IOCs (ThreatFoxResponse): every IOC in the list, IP IOCs
 * geolocated as INDICATOR points, domains/URLs/hashes never resolved. Needs `nc_sources`.
 * Owner: layers-threats-network.
 */
import { threatFoxFeed } from '@/features/network/server/abusech';
import { capabilityGate } from '@/features/network/server/gate';
import { feedJson, withRoute } from '@/lib/respond';

export const dynamic = 'force-dynamic';

export const GET = withRoute('/api/threatfox', async (req) => {
  const gated = capabilityGate('nc_sources', 'threatfox');
  if (gated) return gated;
  return feedJson(req, await threatFoxFeed.get(), (d) => ({ items: d.items, located: d.located }));
});
