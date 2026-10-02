/** GET /api/osint/dns?domain=&type= — DNS records via dns.google DoH (+ SPF/DMARC/CAA findings). Owner: panels-recon. */
import { z } from 'zod';
import { DNS_TYPES, dnsLookup } from '@/components/panels/recon/server/osint';
import { osintRoute } from '@/components/panels/recon/server/route-kit';
import { DomainParam } from '@/components/panels/recon/targets';

export const dynamic = 'force-dynamic';

const Query = z.object({ domain: DomainParam, type: z.enum(DNS_TYPES).optional() });

export const GET = osintRoute('dns', '/api/osint/dns', Query, 300, async (q) => ({ query: q.domain, ...(await dnsLookup(q.domain, q.type)) }));
