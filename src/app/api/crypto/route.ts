/**
 * GET /api/crypto — BTC/ETH/SOL spot (Binance → Coinbase → Kraken; CoinGecko only with a demo key),
 * each quote with its own provider and observation time. Owner: panels-alerts-markets-dossier-graph.
 */
import { cryptoFeed } from '@/components/panels/intel/feeds';
import { feedJson, withRoute } from '@/lib/respond';

export const dynamic = 'force-dynamic';

export const GET = withRoute('/api/crypto', async (req) => feedJson(req, await cryptoFeed.get(), (d) => ({ items: d.items })));
