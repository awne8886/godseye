/**
 * GET /api/cyber-threats — CISA Known Exploited Vulnerabilities, newest first, with NVD CVSS where
 * already fetched (KevResponse). `?limit=N` (1–2000) serves only the N newest additions — the NETWORK
 * layers use it for the Intel Feed — and `total` always reports the full catalogue size.
 * Owner: layers-threats-network.
 */
import { z } from 'zod';
import { kevFeed } from '@/features/network/server/kev';
import { feedJson, parseQuery, withRoute } from '@/lib/respond';

export const dynamic = 'force-dynamic';

const Query = z.object({ limit: z.coerce.number().int().min(1).max(2000).optional() });

export const GET = withRoute('/api/cyber-threats', async (req) => {
  const q = parseQuery(req, Query);
  if (!q.ok) return q.response;
  const { limit } = q.data;
  return feedJson(req, await kevFeed.get(), (d) => ({ items: limit === undefined ? d.items : d.items.slice(0, limit), total: d.items.length, catalogVersion: d.catalogVersion, enriched: d.enriched }));
});
