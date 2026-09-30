/**
 * GET /api/ticker — status-bar marquee: BTC/ETH/SOL (Binance first) and the five latest M4.0+
 * quakes from the USGS 2.5_day feed, each with its own observedAt. Server-side so browsers never
 * call CoinGecko/USGS. Owner: panels-alerts-markets-dossier-graph.
 */
import { tickerFeed } from '@/components/panels/intel/feeds';
import { feedJson, withRoute } from '@/lib/respond';

export const dynamic = 'force-dynamic';

export const GET = withRoute('/api/ticker', async (req) => feedJson(req, await tickerFeed.get(), (d) => ({ crypto: d.crypto, quakes: d.quakes })));
