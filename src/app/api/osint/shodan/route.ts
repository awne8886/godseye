/** GET /api/osint/shodan?ip= — Shodan InternetDB (ports, CPEs, vulns; non-commercial → nc_sources). Owner: panels-recon. */
import { z } from 'zod';
import { shodanLookup } from '@/components/panels/recon/server/osint';
import { PublicIpParam, osintRoute } from '@/components/panels/recon/server/route-kit';

export const dynamic = 'force-dynamic';

const Query = z.object({ ip: PublicIpParam });

export const GET = osintRoute('shodan', '/api/osint/shodan', Query, 3600, async (q) => ({ query: q.ip, ...(await shodanLookup(q.ip)) }));
