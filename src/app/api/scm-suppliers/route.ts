/**
 * GET /api/scm-suppliers — reference supplier sites with live hazard proximity checks (method
 * stated per threat). Owner: panels-alerts-markets-dossier-graph.
 */
import { scmFeed } from '@/components/panels/intel/feeds';
import { feedJson, withRoute } from '@/lib/respond';

export const dynamic = 'force-dynamic';

export const GET = withRoute('/api/scm-suppliers', async (req) => feedJson(req, await scmFeed.get(), (d) => ({ items: d.items })));
