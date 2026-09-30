/**
 * POST /api/ai/overview {scope, provider?} — one-click read-out of the current feed (alerts, markets
 * or chain). A model answers when configured (server key or the visitor's `x-ai-key`); otherwise the
 * deterministic ANALYST digest answers and says why. Always `no-store`.
 * Owner: panels-alerts-markets-dossier-graph.
 */
import { z } from 'zod';
import { overviewPrompt, readSnapshot } from '@/components/panels/intel/server/ai-context';
import { PreferenceSchema, readBody, respondAi } from '@/components/panels/intel/server/ai-route';
import { withRoute } from '@/lib/respond';

export const dynamic = 'force-dynamic';

const Body = z.object({ scope: z.enum(['alerts', 'markets', 'chain']).default('alerts'), provider: PreferenceSchema });

export const POST = withRoute('/api/ai/overview', async (req) => {
  const b = await readBody(req, Body);
  if (!b.ok) return b.response;
  return respondAi(req, b.data.provider, overviewPrompt(b.data.scope, await readSnapshot()));
});
