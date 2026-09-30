/** GET /api/osint/cve?id=CVE-YYYY-NNNN — MITRE (CIRCL fallback) + NVD with the CISA KEV flag. Owner: panels-recon. */
import { z } from 'zod';
import { cveLookup } from '@/components/panels/recon/server/osint';
import { osintRoute } from '@/components/panels/recon/server/route-kit';
import { CVE_RE } from '@/components/panels/recon/targets';

export const dynamic = 'force-dynamic';

const Query = z.object({
  id: z
    .string()
    .trim()
    .toUpperCase()
    .regex(CVE_RE, 'Enter a CVE id such as CVE-2024-3400'),
});

export const GET = osintRoute('cve', '/api/osint/cve', Query, 3600, async (q) => ({ query: q.id, ...(await cveLookup(q.id)) }));
