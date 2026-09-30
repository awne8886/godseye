/**
 * POST /api/ai/analyze {lat, lng, provider?} — read-out of what the current feeds place within
 * 300 km of a point, citing feed rows. ANALYST fallback when no model is available.
 * Owner: panels-alerts-markets-dossier-graph.
 */
import { z } from 'zod';
import { analyzePrompt, readSnapshot } from '@/components/panels/intel/server/ai-context';
import { PreferenceSchema, readBody, respondAi } from '@/components/panels/intel/server/ai-route';
import { withRoute } from '@/lib/respond';

export const dynamic = 'force-dynamic';

const Body = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), provider: PreferenceSchema });

export const POST = withRoute('/api/ai/analyze', async (req) => {
  const b = await readBody(req, Body);
  if (!b.ok) return b.response;
  return respondAi(req, b.data.provider, analyzePrompt(b.data.lat, b.data.lng, await readSnapshot()));
});
