/** GET /api/osint/mac?mac= — MAC/OUI vendor (maclookup.app). Owner: panels-recon. */
import { z } from 'zod';
import { macLookup } from '@/components/panels/recon/server/osint';
import { osintRoute } from '@/components/panels/recon/server/route-kit';
import { parseMac } from '@/components/panels/recon/targets';

export const dynamic = 'force-dynamic';

const Query = z.object({
  mac: z.string().transform((v, ctx) => {
    const m = parseMac(v);
    if (!m) {
      ctx.addIssue({ code: 'custom', message: 'Enter a MAC address or OUI prefix (e.g. 00:1A:2B)' });
      return z.NEVER;
    }
    return m;
  }),
});

export const GET = osintRoute('mac', '/api/osint/mac', Query, 86_400, async (q) => ({ query: q.mac, ...(await macLookup(q.mac)) }));
