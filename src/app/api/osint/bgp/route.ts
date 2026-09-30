/** GET /api/osint/bgp?query=AS15169|8.8.8.8 — holder, prefixes, neighbours (RIPEstat, ≤ 8 concurrent, daily budget). Owner: panels-recon. */
import net from 'node:net';
import { z } from 'zod';
import { isReservedIp } from '@/lib/ssrf';
import { bgpLookup } from '@/components/panels/recon/server/osint';
import { osintRoute } from '@/components/panels/recon/server/route-kit';
import { parseAsn } from '@/components/panels/recon/server/targets';

export const dynamic = 'force-dynamic';

const Query = z.object({
  query: z
    .string()
    .trim()
    .transform((v, ctx) => {
      const asn = parseAsn(v);
      if (asn) return { asn } as const;
      if (net.isIP(v) && !isReservedIp(v)) return { ip: v } as const;
      ctx.addIssue({ code: 'custom', message: 'Enter an ASN (AS15169) or a public IP address' });
      return z.NEVER;
    }),
});

export const GET = osintRoute('bgp', '/api/osint/bgp', Query, 3600, async (q) => ({ query: 'asn' in q.query ? `AS${q.query.asn}` : q.query.ip, ...(await bgpLookup(q.query)) }));
