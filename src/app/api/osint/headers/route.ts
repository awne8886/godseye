/**
 * GET /api/osint/headers?url= — security-header grade for a public URL, proxied through this
 * server by safeFetch() (SSRF guard on every hop). A blocked target or redirect answers 400.
 * Owner: panels-recon.
 */
import { z } from 'zod';
import { assertPublicUrl } from '@/lib/ssrf';
import { apiError } from '@/lib/respond';
import { headersLookup, targetUrl } from '@/components/panels/recon/server/headers';
import { osintRoute } from '@/components/panels/recon/server/route-kit';

export const dynamic = 'force-dynamic';

const Query = z.object({ url: z.string().trim().min(1).max(2048) });

export const GET = osintRoute('headers', '/api/osint/headers', Query, 300, async (q) => {
  const url = targetUrl(q.url);
  await assertPublicUrl(url);
  const r = await headersLookup(url.toString());
  if (r.providers.target?.error === 'blocked' || r.providers.target?.error === 'redirect') {
    return apiError(400, 'blocked_target', 'The target redirected to an address or scheme this server will not fetch.');
  }
  return { query: url.toString(), ...r };
});
