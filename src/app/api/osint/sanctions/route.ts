/**
 * GET /api/osint/sanctions?q= — OFAC SDN search over the OpenSanctions bulk export, downloaded
 * daily by this server (the query never leaves it). CC BY-NC 4.0 → behind nc_sources.
 * Owner: panels-recon.
 */
import { z } from 'zod';
import { hasCapability } from '@/lib/capabilities';
import { skipped } from '@/components/panels/recon/server/lookup';
import { osintRoute } from '@/components/panels/recon/server/route-kit';
import { SANCTIONS_ATTRIBUTION, loadSdn, searchSdn } from '@/components/panels/recon/server/sanctions';

export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const Query = z.object({ q: z.string().trim().min(2, 'Enter at least 2 characters').max(120) });

export const GET = osintRoute('sanctions', '/api/osint/sanctions', Query, 86_400, async (q) => {
  if (!hasCapability('nc_sources')) return { query: q.q, data: { q: q.q, matches: [] }, findings: [], providers: { opensanctions: skipped('licence') } };
  const { entries, status } = await loadSdn();
  const hits = entries ? searchSdn(entries, q.q) : [];
  return {
    query: q.q,
    data: {
      q: q.q,
      listSize: entries?.length ?? null,
      matches: hits.map((h) => ({ ...h.entry, matched: h.matched, exact: h.exact })),
      attribution: SANCTIONS_ATTRIBUTION,
    },
    findings: entries
      ? hits.length
        ? hits.slice(0, 5).map((h) => ({ level: h.exact ? ('critical' as const) : ('high' as const), label: `${h.exact ? 'Exact' : 'Partial'} SDN match: ${h.entry.name}`, detail: `${h.entry.schema} · ${h.entry.sanctions.join('; ') || 'programme not stated'} · name matching only: verify identifiers before acting.` }))
        : [{ level: 'info' as const, label: 'No SDN match', detail: `No OFAC SDN name or alias contains every word of "${q.q}".` }]
      : [],
    providers: { opensanctions: { ...status, count: hits.length } },
  };
});
