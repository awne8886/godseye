/** GET /api/osint/certs?domain= — certificate transparency (crt.sh, 20 s + 1 retry) and subdomains. Owner: panels-recon. */
import { z } from 'zod';
import { certsLookup } from '@/components/panels/recon/server/osint';
import { osintRoute } from '@/components/panels/recon/server/route-kit';
import { DomainParam } from '@/components/panels/recon/targets';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const Query = z.object({ domain: DomainParam });

export const GET = osintRoute('certs', '/api/osint/certs', Query, 3600, async (q) => ({ query: q.domain, ...(await certsLookup(q.domain)) }));
