/**
 * GET /api/chain/daily?days=30 — exploits (DefiLlama), cryptocurrency CVEs (NVD) and OFAC-listed
 * wallets (OpenSanctions, keyed). Owner: panels-alerts-markets-dossier-graph.
 */
import { z } from 'zod';
import { chainFeed } from '@/components/panels/intel/feeds';
import { feedJson, parseQuery, withRoute } from '@/lib/respond';

export const dynamic = 'force-dynamic';

const Query = z.object({ days: z.coerce.number().int().min(1).max(120).default(30) });

export const GET = withRoute('/api/chain/daily', async (req) => {
  const q = parseQuery(req, Query);
  if (!q.ok) return q.response;
  const since = Date.now() - q.data.days * 86_400_000;
  return feedJson(req, await chainFeed.get(), (d) => ({
    windowDays: q.data.days,
    exploits: d.exploits.filter((e) => Date.parse(`${e.date}T00:00:00Z`) >= since),
    cves: d.cves.filter((c) => Date.parse(c.published) >= since),
    sanctionedWallets: d.sanctionedWallets,
    degraded: d.degraded,
  }));
});
