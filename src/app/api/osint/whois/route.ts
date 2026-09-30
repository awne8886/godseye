/** GET /api/osint/whois?domain= — RDAP registration data (rdap.org bootstrap → registry). Owner: panels-recon. */
import { z } from 'zod';
import { whoisLookup } from '@/components/panels/recon/server/osint';
import { osintRoute } from '@/components/panels/recon/server/route-kit';
import { DomainParam } from '@/components/panels/recon/targets';

export const dynamic = 'force-dynamic';

const Query = z.object({ domain: DomainParam });

export const GET = osintRoute('whois', '/api/osint/whois', Query, 3600, async (q) => ({ query: q.domain, ...(await whoisLookup(q.domain)) }));
