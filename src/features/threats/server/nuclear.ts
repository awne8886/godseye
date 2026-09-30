/**
 * Nuclear facilities (REFERENCE) with live context flags. Owner: layers-threats-network. Server-only.
 *
 * Probed 2026-09-30: Wikidata SPARQL (`wdt:P31/wdt:P279* wd:Q134447` + P625) 200 in 2.6 s,
 * 401 bindings → 382 distinct plants, CC0, ACAO *. Merged with the curated OSIRIS list (64 sites,
 * MIT; includes research reactors and fuel-cycle sites Wikidata's class misses). A curated site
 * within 10 km of a Wikidata plant enriches it instead of duplicating it. Cancelled projects
 * (never built) are dropped.
 *
 * Flags (method stated on every flag):
 *  - seismic: a USGS M ≥ 4.5 quake within 150 km in the last 24 h (read in-process from the
 *    `earthquakes` feed; never re-fetched here).
 *  - conflict: ≥ 1 GDELT material-conflict (QuadClass 4) event geocoded to a settlement within 50 km
 *    in the conflict feed's rolling window.
 */
import 'server-only';
import { defineFeed, getFeed, runProvider } from '@/lib/feeds';
import { distanceKm } from '@/lib/geo';
import { httpJson } from '@/lib/http';
import { providerBucket } from '@/lib/ratelimit';
import type { ConflictEvent, NuclearSite, NuclearStatus } from '@/lib/types';
import { conflictsFeed } from './conflicts';
import { readRef } from './refdata';

export const SPARQL_URL = 'https://query.wikidata.org/sparql';
export const NUCLEAR_QUERY = `SELECT ?item ?itemLabel ?coord ?countryLabel ?statusLabel ?operatorLabel ?capacity WHERE {
  ?item wdt:P31/wdt:P279* wd:Q134447; wdt:P625 ?coord .
  OPTIONAL { ?item wdt:P17 ?country } OPTIONAL { ?item wdt:P5817 ?status }
  OPTIONAL { ?item wdt:P137 ?operator } OPTIONAL { ?item wdt:P2109 ?capacity }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`;

interface Binding {
  item: { value: string };
  itemLabel?: { value: string };
  coord?: { value: string };
  countryLabel?: { value: string };
  statusLabel?: { value: string };
  operatorLabel?: { value: string };
  capacity?: { value: string };
}

export function wikidataStatus(label: string | undefined): NuclearStatus | 'cancelled' {
  const s = (label ?? '').toLowerCase();
  if (!s) return 'unknown';
  if (s === 'cancelled') return 'cancelled';
  if (s.includes('decommission')) return 'decommissioned';
  if (s.includes('under construction')) return 'under_construction';
  if (s === 'in use' || s === 'starting up' || s.includes('partial operation')) return 'operational';
  if (s.includes('proposed') || s === 'project' || s === 'postponed' || s.includes('planned')) return 'planned';
  if (s.includes('shut') || s.includes('closed')) return 'shutdown';
  return 'unknown';
}

export function curatedStatus(text: string): NuclearStatus {
  const s = text.toLowerCase();
  if (s.includes('under construction')) return 'under_construction';
  if (s.includes('decommission')) return 'decommissioned';
  if (s.includes('suspended') || s.includes('shutdown')) return 'shutdown';
  if (s.startsWith('operational') || s.startsWith('partially operational')) return 'operational';
  return 'unknown';
}

const WKT = /^Point\(([-\d.eE]+) ([-\d.eE]+)\)$/;

export function parseWikidata(bindings: Binding[]): NuclearSite[] {
  const byId = new Map<string, NuclearSite & { cancelled?: boolean }>();
  for (const b of bindings) {
    const qid = /Q\d+$/.exec(b.item.value)?.[0];
    const m = b.coord && WKT.exec(b.coord.value);
    if (!qid || !m) continue;
    const lng = Number(m[1]);
    const lat = Number(m[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    let site = byId.get(qid);
    if (!site) {
      const label = b.itemLabel?.value;
      site = {
        id: `wd-${qid}`,
        lat,
        lng,
        observedAt: null,
        source: 'wikidata',
        name: label && label !== qid ? label : qid,
        country: b.countryLabel?.value ?? null,
        city: null,
        status: 'unknown',
        operator: null,
        reactors: null,
        capacityMwe: null,
        wikidataId: qid,
        sourceUrl: `https://www.wikidata.org/wiki/${qid}`,
        flags: [],
      };
      byId.set(qid, site);
    }
    const st = wikidataStatus(b.statusLabel?.value);
    if (st === 'cancelled') site.cancelled = true;
    else if (site.status === 'unknown') site.status = st;
    if (!site.operator && b.operatorLabel?.value && !/^Q\d+$/.test(b.operatorLabel.value)) site.operator = b.operatorLabel.value;
    const cap = b.capacity ? Number(b.capacity.value) : NaN;
    if (Number.isFinite(cap) && cap > 0 && (site.capacityMwe === null || cap > site.capacityMwe)) site.capacityMwe = cap;
  }
  // A plant is dropped only if every status statement says cancelled.
  return [...byId.values()].filter((s) => !(s.cancelled && s.status === 'unknown')).map(({ cancelled: _c, ...s }) => s);
}

interface Curated {
  id: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
  status: string;
  reactors: number;
  capacityMW: number;
  owner: string;
  sourceUrl?: string;
}

/** Merge the curated list into the Wikidata plants (≤ 10 km = the same site). Pure. */
export function mergeNuclear(wikidata: NuclearSite[], curated: Curated[]): NuclearSite[] {
  const out = wikidata.map((s) => ({ ...s, flags: [...s.flags] }));
  for (const c of curated) {
    const match = out.find((s) => s.source === 'wikidata' && distanceKm([s.lng, s.lat], [c.lng, c.lat]) <= 10);
    if (match) {
      match.city ??= c.city || null;
      match.reactors ??= c.reactors > 0 ? c.reactors : null;
      match.capacityMwe ??= c.capacityMW > 0 ? c.capacityMW : null;
      match.operator ??= c.owner || null;
      if (match.status === 'unknown') match.status = curatedStatus(c.status);
      continue;
    }
    out.push({
      id: c.id,
      lat: c.lat,
      lng: c.lng,
      observedAt: null,
      source: 'curated',
      name: c.name,
      country: c.country || null,
      city: c.city || null,
      status: curatedStatus(c.status),
      operator: c.owner || null,
      reactors: c.reactors > 0 ? c.reactors : null,
      capacityMwe: c.capacityMW > 0 ? c.capacityMW : null,
      wikidataId: null,
      sourceUrl: c.sourceUrl && /^https?:\/\//.test(c.sourceUrl) ? c.sourceUrl : null,
      flags: [],
    });
  }
  return out;
}

interface Quake {
  id: string;
  lat: number;
  lng: number;
  magnitude: number;
  observedAt: string | null;
  place?: string | null;
}

export const SEISMIC_METHOD = 'USGS earthquake M ≥ 4.5 within 150 km (great-circle) in the last 24 h';
export const CONFLICT_METHOD = 'GDELT material-conflict (QuadClass 4) events geocoded to a settlement within 50 km, rolling window ≤ 24 h';

/** Attach seismic/conflict flags. Pure. */
export function flagSites(sites: NuclearSite[], quakes: readonly Quake[], events: readonly (ConflictEvent & { quad?: number })[], now = Date.now()): NuclearSite[] {
  const recent = quakes.filter((q) => q.magnitude >= 4.5 && q.observedAt && now - Date.parse(q.observedAt) <= 24 * 3600_000);
  const near = events.filter((e) => e.precision === 'settlement');
  return sites.map((s) => {
    const flags: NuclearSite['flags'] = [];
    const qs = recent.filter((q) => distanceKm([s.lng, s.lat], [q.lng, q.lat]) <= 150);
    if (qs.length) {
      const top = qs.reduce((a, b) => (b.magnitude > a.magnitude ? b : a));
      const km = Math.round(distanceKm([s.lng, s.lat], [top.lng, top.lat]));
      flags.push({ kind: 'seismic', label: `M${top.magnitude.toFixed(1)} earthquake ${km} km away`, method: SEISMIC_METHOD, observedAt: top.observedAt! });
    }
    const es = near.filter((e) => distanceKm([s.lng, s.lat], [e.lng, e.lat]) <= 50);
    if (es.length) {
      const newest = es.reduce((a, b) => (Date.parse(b.observedAt) > Date.parse(a.observedAt) ? b : a));
      flags.push({ kind: 'conflict', label: `${es.length} conflict event${es.length > 1 ? 's' : ''} reported within 50 km`, method: CONFLICT_METHOD, observedAt: newest.observedAt });
    }
    return flags.length ? { ...s, flags } : s;
  });
}

export const wikidataFeed = defineFeed<{ items: NuclearSite[] }>({
  key: 'nuclear-wikidata',
  ttlMs: 24 * 60 * 60_000,
  pollMs: 6 * 60 * 60_000,
  kind: 'reference',
  attribution: [{ text: 'Wikidata nuclear power plants', url: 'https://www.wikidata.org/', licence: 'CC0' }],
  count: (d) => d.items.length,
  deadlineMs: 60_000,
  run: async ({ signal }) => {
    const { result, run } = await runProvider(
      async () => {
        const url = `${SPARQL_URL}?query=${encodeURIComponent(NUCLEAR_QUERY)}`;
        const res = await httpJson<{ results?: { bindings?: Binding[] } }>(url, {
          signal,
          timeoutMs: 45_000,
          headers: { accept: 'application/sparql-results+json' },
          limiter: providerBucket('wikidata-sparql', 1),
        });
        return parseWikidata(res.data?.results?.bindings ?? []);
      },
      (r) => r.length,
    );
    return { data: { items: result ?? [] }, providers: { wikidata: run } };
  },
});

function quakesInProcess(): Quake[] {
  const f = getFeed('earthquakes');
  const d = f?.peek().data as { items?: Quake[] } | null | undefined;
  return d?.items ?? [];
}

export const infrastructureFeed = defineFeed<{ items: NuclearSite[] }>({
  key: 'infrastructure',
  ttlMs: 30 * 60_000,
  kind: 'reference',
  attribution: [
    { text: 'Nuclear plants: Wikidata', url: 'https://www.wikidata.org/', licence: 'CC0' },
    { text: 'Curated facility list (OSIRIS, MIT)', licence: 'MIT' },
    { text: 'Context flags: USGS earthquakes, GDELT events', url: 'https://earthquake.usgs.gov/' },
  ],
  note: 'Facilities are REFERENCE data; flags are computed from live feeds with the method shown on each flag.',
  count: (d) => d.items.length,
  run: async () => {
    const curated = readRef<{ items: Curated[] }>('nuclear-curated.json').items;
    const wd = await wikidataFeed.get();
    const merged = mergeNuclear(wd.data?.items ?? [], curated);
    // Earthquakes: the hazards feed's latest snapshot (started by instrumentation; never fetched here).
    const quakes = quakesInProcess();
    const conflicts = (await conflictsFeed.get()).data;
    const items = flagSites(merged, quakes, conflicts?.events ?? []);
    const wdRun = wd.providers.wikidata;
    return {
      data: { items },
      providers: {
        wikidata: { status: wdRun ?? { ok: false, count: 0, ms: 0, age_s: null, error: 'offline' }, okAt: wd.meta.fetchedAt ? Date.parse(wd.meta.fetchedAt) : null },
        curated: { status: { ok: true, count: curated.length, ms: 0, age_s: 0 }, okAt: Date.now() },
        usgs_flags: { status: { ok: quakes.length > 0, count: items.filter((s) => s.flags.some((f) => f.kind === 'seismic')).length, ms: 0, age_s: 0, ...(quakes.length ? {} : { error: 'earthquakes feed not loaded' }) }, okAt: quakes.length ? Date.now() : null },
      },
    };
  },
});
