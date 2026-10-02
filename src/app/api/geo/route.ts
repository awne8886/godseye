/**
 * GET /api/geo — the visitor's approximate region from their IP address, for "centre on my
 * region". The client calls it ONLY after the visitor clicks that control (settings.geoConsent);
 * the answer is region-level (0.1°), never cached or logged. ipwho.is, then freeipapi.
 * Owner: panels-recon.
 */
import { isReservedIp } from '@/lib/ssrf';
import { apiError, json, withRoute } from '@/lib/respond';
import { getClientIp } from '@/lib/ratelimit';
import { visitorRegion } from '@/components/panels/recon/server/geo';
import { anyOk, offline } from '@/components/panels/recon/server/lookup';

export const dynamic = 'force-dynamic';

export const GET = withRoute('/api/geo', async (req: Request) => {
  const ip = getClientIp(req.headers);
  if (ip === 'unknown' || isReservedIp(ip)) {
    return apiError(422, 'no_public_ip', 'This server cannot see a public IP address for you (local or private network), so there is no region to centre on.');
  }
  const r = await visitorRegion(ip);
  if (!anyOk(r.providers)) return offline(r.providers, 'The IP geolocation providers are unavailable.');
  return json(
    { results: r.results, attribution: 'IP geolocation: ipwho.is · freeipapi.com (approximate, region level)', providers: r.providers, timestamp: new Date().toISOString() },
    { ttl: 0 },
  );
});
