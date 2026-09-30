/** GET /api/osint/ip?ip= — geolocation, ASN/prefix, hosting/proxy flags (nc) and OFAC country check. Owner: panels-recon. */
import { z } from 'zod';
import { ipLookup } from '@/components/panels/recon/server/osint';
import { PublicIpParam, osintRoute } from '@/components/panels/recon/server/route-kit';

export const dynamic = 'force-dynamic';

const Query = z.object({ ip: PublicIpParam });

export const GET = osintRoute('ip', '/api/osint/ip', Query, 3600, async (q) => ({ query: q.ip, ...(await ipLookup(q.ip)) }));
