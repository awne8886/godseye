/**
 * GET /api/osint/sweep?ip=&cidr=28..32 — passive sweep of a small public IPv4 prefix (≤ 16
 * addresses) from Shodan InternetDB's existing scan data. No packets are sent to the targets.
 * Owner: panels-recon.
 */
import net from 'node:net';
import { z } from 'zod';
import { sweepLookup } from '@/components/panels/recon/server/osint';
import { PublicIpParam, osintRoute } from '@/components/panels/recon/server/route-kit';

export const dynamic = 'force-dynamic';

const Query = z.object({
  ip: PublicIpParam.refine((v) => net.isIPv4(v), 'Sweeps take a public IPv4 address'),
  cidr: z.coerce.number().int().min(28, 'Prefixes larger than /28 (16 addresses) are not swept').max(32).default(30),
});

export const GET = osintRoute('sweep', '/api/osint/sweep', Query, 3600, async (q) => ({ query: `${q.ip}/${q.cidr}`, ...(await sweepLookup(q.ip, q.cidr)) }));
