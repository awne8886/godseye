/**
 * GET /api/osint/leaks?domain= — known breaches of an ORGANISATION domain (xposedornot). Personal
 * email addresses are refused: GODSEYE does not do people-search (§0.7). Owner: panels-recon.
 */
import { z } from 'zod';
import { leaksLookup } from '@/components/panels/recon/server/osint';
import { osintRoute } from '@/components/panels/recon/server/route-kit';
import { DomainParam } from '@/components/panels/recon/targets';

export const dynamic = 'force-dynamic';

const Query = z.object({ domain: DomainParam });

export const GET = osintRoute('leaks', '/api/osint/leaks', Query, 86_400, async (q) => ({ query: q.domain, ...(await leaksLookup(q.domain)) }));
