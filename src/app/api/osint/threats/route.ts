/**
 * GET /api/osint/threats?ioc= — an IP, domain, URL or file hash against threat intel: Tor exit
 * list (exact match), Feodo Tracker (nc), ThreatFox (ABUSECH_AUTH_KEY), OTX (OTX_KEY). The
 * indicator is never resolved or fetched by this server. Owner: panels-recon.
 */
import { z } from 'zod';
import { isReservedIp } from '@/lib/ssrf';
import { threatsLookup } from '@/components/panels/recon/server/osint';
import { osintRoute } from '@/components/panels/recon/server/route-kit';
import { iocKind } from '@/components/panels/recon/targets';

export const dynamic = 'force-dynamic';

const Query = z.object({
  ioc: z
    .string()
    .trim()
    .max(2048)
    .transform((v, ctx) => {
      const kind = iocKind(v);
      if (!kind) {
        ctx.addIssue({ code: 'custom', message: 'Enter an IP, domain, URL or MD5/SHA1/SHA256 hash' });
        return z.NEVER;
      }
      if ((kind === 'ipv4' || kind === 'ipv6') && isReservedIp(v)) {
        ctx.addIssue({ code: 'custom', message: 'Private or reserved addresses are not looked up' });
        return z.NEVER;
      }
      return { ioc: kind === 'md5' || kind === 'sha1' || kind === 'sha256' ? v.toLowerCase() : v, kind };
    }),
});

export const GET = osintRoute('threats', '/api/osint/threats', Query, 600, async (q) => ({ query: q.ioc.ioc, ...(await threatsLookup(q.ioc.ioc, q.ioc.kind)) }));
