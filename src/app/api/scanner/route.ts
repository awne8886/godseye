/**
 * GET /api/scanner?type=&target= — allow-listed scans proxied through this server to the
 * operator's optional backend (SCANNER_URL + SCANNER_KEY). Disabled (503 not_configured) unless
 * configured; active types need SCANNER_ALLOW_ACTIVE=true. 5/min per IP, fail-closed.
 * Owner: panels-recon.
 */
import { z } from 'zod';
import { errorReason } from '@/lib/http';
import { json, parseQuery, withRoute } from '@/lib/respond';
import { osintBody } from '@/components/panels/recon/server/lookup';
import { planScan, runScan } from '@/components/panels/recon/server/scanner';

export const dynamic = 'force-dynamic';
export const maxDuration = 100;

const Query = z.object({ type: z.string().trim().min(1).max(20), target: z.string().trim().min(1).max(253) });

export const GET = withRoute('/api/scanner', async (req: Request) => {
  const q = parseQuery(req, Query);
  if (!q.ok) return q.response;
  const plan = await planScan(q.data.type, q.data.target);
  if (!plan.ok) {
    const body: Record<string, unknown> = { error: plan.error, detail: plan.detail };
    if (plan.available) body.available = plan.available;
    return json(body, { status: plan.status, ttl: 0 });
  }
  const t0 = Date.now();
  try {
    const r = await runScan(plan);
    const body = osintBody('scanner', `${plan.host} (${plan.ip})`, { type: q.data.type, active: plan.type.active, via: 'proxied through this server', pinnedIp: plan.ip, result: r.data }, [], {
      scanner: { ok: true, count: 1, ms: r.ms, age_s: 0 },
    });
    return json(body, { ttl: 0 });
  } catch (e) {
    return json(
      { error: 'scanner_unavailable', detail: 'The scanner backend did not answer.', providers: { scanner: { ok: false, count: 0, ms: Date.now() - t0, age_s: null, error: errorReason(e) } } },
      { status: 502, ttl: 0 },
    );
  }
});
