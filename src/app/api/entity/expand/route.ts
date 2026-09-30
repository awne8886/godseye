/**
 * GET /api/entity/expand?type=company&id=Q95 — one hop of the Entity Graph (EntityGraphResponse)
 * from Wikidata, RIPEstat and (keyed) OpenSanctions, with provenance on every link. Ids must be
 * identifiers (QID, OpenSanctions id, ICAO hex, MMSI/IMO, IP, ASN, ISO country) — no free-text
 * people search. Owner: panels-alerts-markets-dossier-graph.
 */
import { z } from 'zod';
import { EXPAND_TYPES, canonicalId, runExpand, type GraphData } from '@/components/panels/intel/server/entity';
import { lookup } from '@/components/panels/intel/server/lookup';
import { apiError, json, parseQuery, withRoute } from '@/lib/respond';

export const dynamic = 'force-dynamic';

const Query = z.object({ type: z.enum(EXPAND_TYPES), id: z.string().min(1).max(64) });

export const GET = withRoute('/api/entity/expand', async (req) => {
  const q = parseQuery(req, Query);
  if (!q.ok) return q.response;
  const id = canonicalId(q.data.type, q.data.id);
  if (!id) return apiError(400, 'invalid_request', `id is not a valid ${q.data.type} identifier`);
  const r = await lookup<GraphData>(`entity:${q.data.type}:${id}`, {
    feed: 'entity',
    ttlMs: 24 * 3600_000,
    attribution: [{ text: 'Wikidata (CC0)' }, { text: 'RIPEstat (RIPE NCC)' }, { text: 'OpenSanctions (keyed; CC BY-NC 4.0 / commercial licence)' }],
    isEmpty: (d) => d.nodes.length === 0,
    run: (signal) => runExpand(q.data.type, id, signal),
  });
  if (r.data === null) return json({ error: 'source_offline', detail: 'No entity upstream answered.', providers: r.providers }, { status: 503, headers: { 'Retry-After': '30' } });
  return json({ root: r.data.root, nodes: r.data.nodes, links: r.data.links, providers: r.providers, timestamp: r.meta.fetchedAt ?? new Date().toISOString() }, { ttl: 3600 });
});
