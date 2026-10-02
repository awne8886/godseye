/** GET /api/osint/crypto?address=&chain=btc|eth|sol — wallet balance/activity with transparent risk factors. Owner: panels-recon. */
import { z } from 'zod';
import { cryptoLookup } from '@/components/panels/recon/server/osint';
import { osintRoute } from '@/components/panels/recon/server/route-kit';
import { detectChain } from '@/components/panels/recon/targets';
import { identifierHits, sdnCache } from '@/components/panels/recon/server/sanctions';

export const dynamic = 'force-dynamic';

const Query = z
  .object({ address: z.string().trim().min(26).max(100), chain: z.enum(['btc', 'eth', 'sol']).optional() })
  .transform((v, ctx) => {
    const detected = detectChain(v.address);
    const chain = v.chain ?? detected;
    if (!detected || detected !== chain) {
      ctx.addIssue({ code: 'custom', message: 'Not a recognised BTC, ETH or SOL address for the chain given' });
      return z.NEVER;
    }
    return { address: v.address, chain };
  });

export const GET = osintRoute('crypto', '/api/osint/crypto', Query, 300, async (q) => {
  const r = await cryptoLookup(q.address, q.chain);
  // OFAC-listed wallet addresses: only when the SDN list is already loaded (no 7.5 MB download per lookup).
  const sdn = sdnCache.peek().data;
  if (sdn) {
    for (const e of identifierHits(sdn, q.address)) r.findings.unshift({ level: 'critical', label: `OFAC SDN: ${e.name}`, detail: `This address is listed as an identifier of an SDN entry (${e.sanctions.join('; ')}).` });
  }
  return { query: q.address, ...r };
});
