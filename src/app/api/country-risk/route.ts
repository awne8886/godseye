/**
 * GET /api/country-risk — INFORM Risk + World Bank WGI per country, with the method on every row
 * (CountryRiskResponse). Owner: layers-threats-network.
 */
import { countryRiskFeed } from '@/features/threats/server/country-risk';
import { feedJson, withRoute } from '@/lib/respond';

export const dynamic = 'force-dynamic';

export const GET = withRoute('/api/country-risk', async (req) => feedJson(req, await countryRiskFeed.get(), (d) => ({ items: d.items })));
