/**
 * Entity Graph expansion. Node ids are identifiers only (Wikidata QID, OpenSanctions id, ICAO hex,
 * MMSI/IMO, IP, ASN, ISO country code); every link carries its provenance (the upstream property it
 * came from). Person nodes only come from Wikidata statements or OpenSanctions records — there is no
 * name search for people. Sources:
 *  - Wikidata `wbgetentities` (company/person/country QIDs; country ISO codes via SPARQL P297),
 *  - RIPEstat network-info / as-overview / asn-neighbours (IP, ASN),
 *  - OpenSanctions search API (aircraft, vessels, companies) with `OPENSANCTIONS_KEY` only (the API
 *    answered 401 keyless on 2026-09-30) — skipped as `not-configured` otherwise.
 * Owner: panels-alerts-markets-dossier-graph. Server-only.
 */
import 'server-only';
import { isIP } from 'node:net';
import { runProvider, skippedProvider, type FeedData, type ProviderRun } from '@/lib/feeds';
import { hasCapability } from '@/lib/capabilities';
import { getJson } from './get-json';
import { providerBucket } from '@/lib/ratelimit';
import type { EntityGraphResponse } from '@/lib/types';

export type NodeType = EntityGraphResponse['nodes'][number]['type'];
export type GraphNode = EntityGraphResponse['nodes'][number];
export type GraphLink = EntityGraphResponse['links'][number];
export interface GraphData {
  root: string;
  nodes: GraphNode[];
  links: GraphLink[];
}

export const EXPAND_TYPES = ['aircraft', 'vessel', 'company', 'person', 'ip', 'asn', 'country'] as const;
export type ExpandType = (typeof EXPAND_TYPES)[number];

/** Validate and canonicalise an id for its type; null = not an identifier we accept. */
export function canonicalId(type: ExpandType, raw: string): string | null {
  const id = raw.trim();
  switch (type) {
    case 'company':
    case 'person':
      return /^Q\d{1,12}$/.test(id) ? id : /^NK-[A-Za-z0-9]{6,40}$/.test(id) ? id : null;
    case 'country':
      return /^[A-Za-z]{2}$/.test(id) ? id.toUpperCase() : /^Q\d{1,12}$/.test(id) ? id : null;
    case 'aircraft':
      return /^[0-9a-fA-F]{6}$/.test(id) ? id.toLowerCase() : null;
    case 'vessel':
      return /^\d{9}$/.test(id) ? id : /^IMO\d{7}$/i.test(id) ? id.toUpperCase() : null;
    case 'asn': {
      const m = id.match(/^(?:AS)?(\d{1,10})$/i);
      return m ? `AS${m[1]}` : null;
    }
    case 'ip':
      return isIP(id) ? id : null;
  }
}

const wdLimiter = () => providerBucket('wikimedia', 5, 5);
const ripeLimiter = () => providerBucket('ripestat', 4, 8);

interface WdClaim {
  mainsnak?: { datavalue?: { value?: { id?: string } | string } };
  qualifiers?: Record<string, unknown>;
}
interface WdEntity {
  id: string;
  labels?: Record<string, { value: string }>;
  claims?: Record<string, WdClaim[]>;
}

/** Wikidata properties followed per root type → (relation label, target node type). */
export const WD_RELATIONS: Record<'company' | 'person' | 'country', Record<string, [string, NodeType]>> = {
  company: { P749: ['parent organization', 'company'], P355: ['subsidiary', 'company'], P127: ['owned by', 'company'], P112: ['founded by', 'person'], P169: ['chief executive officer', 'person'], P17: ['country', 'country'] },
  person: { P27: ['country of citizenship', 'country'], P108: ['employer', 'company'], P102: ['member of political party', 'company'], P39: ['position held', 'company'] },
  country: { P35: ['head of state', 'person'], P6: ['head of government', 'person'], P36: ['capital', 'company'], P463: ['member of', 'company'] },
};

const MAX_PER_PROPERTY = 8;

/** Links from one entity's claims (current statements only: those without an end time P582). */
export function wikidataLinks(e: WdEntity, rootType: 'company' | 'person' | 'country'): { target: string; relation: string; type: NodeType; provenance: string }[] {
  const out: { target: string; relation: string; type: NodeType; provenance: string }[] = [];
  for (const [prop, [relation, type]] of Object.entries(WD_RELATIONS[rootType])) {
    let n = 0;
    for (const c of e.claims?.[prop] ?? []) {
      if (c.qualifiers && 'P582' in c.qualifiers) continue;
      const v = c.mainsnak?.datavalue?.value;
      const target = typeof v === 'object' && v?.id && /^Q\d+$/.test(v.id) ? v.id : null;
      if (!target || n >= MAX_PER_PROPERTY) continue;
      n++;
      out.push({ target, relation, type, provenance: `wikidata:${e.id}#${prop}` });
    }
  }
  return out;
}

async function wdEntities(ids: string[], props: string, signal?: AbortSignal): Promise<Record<string, WdEntity>> {
  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&languages=en&props=${props}&ids=${ids.map(encodeURIComponent).join('|')}`;
  const r = await getJson<{ entities?: Record<string, WdEntity> }>(url, { timeoutMs: 12_000, signal, limiter: wdLimiter() });
  return r.data.entities ?? {};
}

const wdUrl = (q: string) => `https://www.wikidata.org/wiki/${q}`;

async function expandWikidata(type: 'company' | 'person' | 'country', qid: string, signal?: AbortSignal): Promise<GraphData> {
  const root = (await wdEntities([qid], 'labels|claims', signal))[qid];
  if (!root) throw new Error('not_found');
  const rels = wikidataLinks(root, type);
  const labels = rels.length ? await wdEntities([...new Set(rels.map((r) => r.target))].slice(0, 50), 'labels', signal) : {};
  const nodes: GraphNode[] = [{ id: qid, type: type, label: root.labels?.en?.value ?? qid, source: 'wikidata', url: wdUrl(qid) }];
  const links: GraphLink[] = [];
  for (const r of rels) {
    const label = labels[r.target]?.labels?.en?.value;
    if (!label) continue;
    if (!nodes.some((n) => n.id === r.target)) nodes.push({ id: r.target, type: r.type, label, source: 'wikidata', url: wdUrl(r.target) });
    links.push({ source: qid, target: r.target, relation: r.relation, provenance: r.provenance });
  }
  return { root: qid, nodes, links };
}

async function countryQid(iso2: string, signal?: AbortSignal): Promise<string> {
  const q = `SELECT ?c WHERE { ?c wdt:P297 "${iso2}". } LIMIT 1`;
  const r = await getJson<{ results?: { bindings?: { c?: { value: string } }[] } }>(`https://query.wikidata.org/sparql?query=${encodeURIComponent(q)}`, { headers: { Accept: 'application/sparql-results+json' }, timeoutMs: 12_000, signal, limiter: wdLimiter() });
  const qid = r.data.results?.bindings?.[0]?.c?.value.match(/(Q\d+)$/)?.[1];
  if (!qid) throw new Error('not_found');
  return qid;
}

interface RipeResp<T> {
  data: T;
}

async function expandIp(ip: string, signal?: AbortSignal): Promise<GraphData> {
  const r = await getJson<RipeResp<{ asns?: string[]; prefix?: string }>>(`https://stat.ripe.net/data/network-info/data.json?resource=${encodeURIComponent(ip)}`, { timeoutMs: 10_000, signal, limiter: ripeLimiter() });
  const nodes: GraphNode[] = [{ id: ip, type: 'ip', label: r.data.data.prefix ? `${ip} (${r.data.data.prefix})` : ip, source: 'ripestat', url: `https://stat.ripe.net/${encodeURIComponent(ip)}` }];
  const links: GraphLink[] = [];
  for (const a of (r.data.data.asns ?? []).slice(0, 4)) {
    const id = `AS${a}`;
    const ov = await getJson<RipeResp<{ holder?: string }>>(`https://stat.ripe.net/data/as-overview/data.json?resource=${id}`, { timeoutMs: 10_000, signal, limiter: ripeLimiter() }).catch(() => null);
    nodes.push({ id, type: 'asn', label: ov?.data.data.holder ? `${id} ${ov.data.data.holder}` : id, source: 'ripestat', url: `https://stat.ripe.net/${id}` });
    links.push({ source: ip, target: id, relation: `announced by (prefix ${r.data.data.prefix ?? 'unknown'})`, provenance: 'ripestat:network-info' });
  }
  return { root: ip, nodes, links };
}

async function expandAsn(asn: string, signal?: AbortSignal): Promise<GraphData> {
  const [ov, nb] = await Promise.all([
    getJson<RipeResp<{ holder?: string }>>(`https://stat.ripe.net/data/as-overview/data.json?resource=${asn}`, { timeoutMs: 10_000, signal, limiter: ripeLimiter() }),
    getJson<RipeResp<{ neighbours?: { asn: number; type: string; power: number }[] }>>(`https://stat.ripe.net/data/asn-neighbours/data.json?resource=${asn}`, { timeoutMs: 12_000, signal, limiter: ripeLimiter() }).catch(() => null),
  ]);
  const nodes: GraphNode[] = [{ id: asn, type: 'asn', label: ov.data.data.holder ? `${asn} ${ov.data.data.holder}` : asn, source: 'ripestat', url: `https://stat.ripe.net/${asn}` }];
  const links: GraphLink[] = [];
  const top = [...(nb?.data.data.neighbours ?? [])].sort((a, b) => b.power - a.power || a.asn - b.asn).slice(0, 10);
  for (const n of top) {
    const id = `AS${n.asn}`;
    if (!nodes.some((x) => x.id === id)) nodes.push({ id, type: 'asn', label: id, source: 'ripestat', url: `https://stat.ripe.net/${id}` });
    links.push({ source: asn, target: id, relation: n.type === 'left' ? 'upstream neighbour' : n.type === 'right' ? 'downstream neighbour' : 'neighbour', provenance: 'ripestat:asn-neighbours' });
  }
  return { root: asn, nodes, links };
}

interface OsResult {
  id: string;
  caption?: string;
  schema?: string;
  datasets?: string[];
}

async function openSanctions(query: string, signal?: AbortSignal): Promise<OsResult[]> {
  const r = await getJson<{ results?: OsResult[] }>(`https://api.opensanctions.org/search/default?q=${encodeURIComponent(query)}&limit=5`, {
    timeoutMs: 12_000,
    signal,
    headers: { Authorization: `ApiKey ${process.env.OPENSANCTIONS_KEY ?? ''}` },
    limiter: providerBucket('opensanctions', 1, 2),
  });
  return r.data.results ?? [];
}

/** Adds `sanction` nodes for OpenSanctions matches of the root's label/identifier. */
export function addSanctions(g: GraphData, results: OsResult[]): GraphData {
  for (const r of results) {
    if (!r.id || !/^[A-Za-z0-9-]+$/.test(r.id)) continue;
    const id = /^(Q\d+|NK-[A-Za-z0-9]+)$/.test(r.id) ? r.id : `os-${r.id}`;
    if (!g.nodes.some((n) => n.id === id)) g.nodes.push({ id, type: 'sanction', label: `${r.caption ?? r.id}${r.datasets?.length ? ` (${r.datasets.slice(0, 2).join(', ')})` : ''}`, source: 'opensanctions', url: `https://www.opensanctions.org/entities/${encodeURIComponent(r.id)}/` });
    g.links.push({ source: g.root, target: id, relation: 'listed in OpenSanctions', provenance: `opensanctions:${r.id}` });
  }
  return g;
}

export async function runExpand(type: ExpandType, id: string, signal?: AbortSignal): Promise<FeedData<GraphData>> {
  const providers: Record<string, ProviderRun> = {};
  let graph: GraphData = { root: id, nodes: [], links: [] };
  if (type === 'company' || type === 'person' || type === 'country') {
    if (/^NK-/.test(id)) {
      graph.nodes.push({ id, type, label: id, source: 'opensanctions', url: `https://www.opensanctions.org/entities/${id}/` });
    } else {
      const { result, run } = await runProvider(async () => expandWikidata(type, type === 'country' && /^[A-Z]{2}$/.test(id) ? await countryQid(id, signal) : id, signal), (g) => g.nodes.length);
      providers.wikidata = run;
      if (result) graph = result;
    }
  } else if (type === 'ip' || type === 'asn') {
    const { result, run } = await runProvider(() => (type === 'ip' ? expandIp(id, signal) : expandAsn(id, signal)), (g) => g.nodes.length);
    providers.ripestat = run;
    if (result) graph = result;
  } else {
    graph.nodes.push({ id, type, label: type === 'aircraft' ? `ICAO ${id}` : id.startsWith('IMO') ? id : `MMSI ${id}`, source: 'identifier', url: null });
  }
  if (type === 'aircraft' || type === 'vessel' || type === 'company') {
    if (!hasCapability('opensanctions')) providers.opensanctions = skippedProvider('not-configured');
    else {
      const q = graph.nodes.find((n) => n.id === graph.root)?.label ?? id;
      const { result, run } = await runProvider(() => openSanctions(type === 'company' ? q : id, signal), (r) => r.length, { allowEmpty: true });
      providers.opensanctions = run;
      if (result) graph = addSanctions(graph, result);
    }
  }
  return { data: graph, providers, observedAt: null };
}
