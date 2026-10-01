/**
 * GET /api/markets — quotes (Yahoo chart, unofficial; crypto via Binance → Coinbase → Kraken),
 * breadth, 12 exchange sessions (computed at response time) and maritime chokepoint alerts.
 * Owner: panels-alerts-markets-dossier-graph.
 */
import { getMarkets, marketSessions } from '@/components/panels/intel/feeds';
import { feedJson, withRoute } from '@/lib/respond';

export const dynamic = 'force-dynamic';

export const GET = withRoute('/api/markets', async (req) => {
  const now = Date.now();
  // Sessions change on the quarter hour, so the quarter is part of the ETag variant.
  return feedJson(req, await getMarkets(), (d) => ({ quotes: d.quotes, sessions: marketSessions(now), breadth: d.breadth, scmAlerts: d.scmAlerts }), `q${Math.floor(now / 900_000)}`);
});
