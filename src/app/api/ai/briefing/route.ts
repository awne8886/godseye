/**
 * POST /api/ai/briefing {horizon, provider?} — daily briefing (BLUF / key developments / markets /
 * PIRs / outlook). The ANALYST version states that it does not forecast.
 * Owner: panels-alerts-markets-dossier-graph.
 */
import { z } from 'zod';
import { briefingPrompt, readSnapshot } from '@/components/panels/intel/server/ai-context';
import { PreferenceSchema, readBody, respondAi } from '@/components/panels/intel/server/ai-route';
import { withRoute } from '@/lib/respond';

export const dynamic = 'force-dynamic';

const Body = z.object({ horizon: z.enum(['24h', '72h']).default('24h'), provider: PreferenceSchema });

export const POST = withRoute('/api/ai/briefing', async (req) => {
  const b = await readBody(req, Body);
  if (!b.ok) return b.response;
  return respondAi(req, b.data.provider, briefingPrompt(b.data.horizon, await readSnapshot()));
});
