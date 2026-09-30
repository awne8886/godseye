/**
 * Airport resolution for GET /api/airports/search (§8): exact IATA → exact ICAO → gps_code/ident →
 * metro group → MiniSearch fuzzy (name, municipality, keywords, region, country) with boosts
 * (large +3, medium +2, scheduled +3, IATA +1, exact municipality +2) → Photon aerodromes re-ranked
 * against the local index → Photon place / Nominatim (explicit submits only) → nearest 5
 * scheduled-service airports within 150 km. Server-only.
 */
import 'server-only';
import MiniSearch from 'minisearch';
import type { z } from 'zod';
import { runProvider, type ProviderRun } from '@/lib/feeds';
import { distanceKm } from '@/lib/geo';
import { nominatimSearch, photonSearch } from '@/lib/geocode';
import type { AirportMatch as AirportMatchSchema } from '@/lib/schemas/flight-paths';
import type { Place } from '@/lib/types';
import { metroFor, normalizePlace } from '../lib/metro';
import { airportIndex, findAirport, type AirportIndex, type AirportRecord } from './data';

export type AirportMatch = z.infer<typeof AirportMatchSchema>;
type MatchedBy = AirportMatch['matchedBy'];

export const MAX_RESULTS = 12;
export const NEAREST_RADIUS_KM = 150;

interface SearchDoc {
  id: number;
  name: string;
  municipality: string;
  keywords: string;
  region: string;
  country: string;
  codes: string;
}

const engines = new Map<string, MiniSearch<SearchDoc>>();

function engine(idx: AirportIndex): MiniSearch<SearchDoc> {
  let ms = engines.get(idx.kind);
  if (ms) return ms;
  ms = new MiniSearch<SearchDoc>({
    fields: ['name', 'municipality', 'keywords', 'region', 'country', 'codes'],
    storeFields: [],
    processTerm: (t) => normalizePlace(t) || null,
    searchOptions: { boost: { codes: 3, municipality: 2, name: 1.5, keywords: 1.2 }, prefix: true, fuzzy: 0.2, combineWith: 'AND' },
  });
  ms.addAll(
    idx.list.map((a, id) => ({
      id,
      name: a.name,
      municipality: a.municipality ?? '',
      keywords: a.keywords ?? '',
      region: a.region ?? '',
      country: a.country ?? '',
      codes: [a.iata, a.icao, a.gps].filter(Boolean).join(' '),
    })),
  );
  engines.set(idx.kind, ms);
  return ms;
}

export function boost(a: AirportRecord, q: string): number {
  let b = 0;
  if (a.type === 'large_airport') b += 3;
  else if (a.type === 'medium_airport') b += 2;
  if (a.scheduledService) b += 3;
  if (a.iata) b += 1;
  if (a.municipality && normalizePlace(a.municipality) === normalizePlace(q)) b += 2;
  return b;
}

const match = (a: AirportRecord, score: number, matchedBy: MatchedBy): AirportMatch => {
  const { gps: _g, keywords: _k, longestRunwayM: _r, ...rest } = a;
  return { ...rest, score: Math.round(score * 100) / 100, matchedBy };
};

/** Exact code matches in resolve order (IATA → ICAO → gps_code/ident), default index then all. */
export function exactMatches(q: string, all: boolean): AirportMatch[] {
  const c = q.trim().toUpperCase();
  if (!/^[A-Z0-9-]{2,10}$/.test(c)) return [];
  const out: AirportMatch[] = [];
  const seen = new Set<string>();
  const add = (a: AirportRecord | undefined, by: MatchedBy, score: number) => {
    if (a && !seen.has(a.ident)) {
      seen.add(a.ident);
      out.push(match(a, score, by));
    }
  };
  for (const kind of all ? (['min', 'all'] as const) : (['min'] as const)) {
    const idx = airportIndex(kind);
    if (c.length === 3) add(idx.byIata.get(c), 'iata', 100);
    if (c.length === 4) add(idx.byIcao.get(c), 'icao', 99);
    add(idx.byIdent.get(c), 'ident', 98);
  }
  return out;
}

export function fuzzyMatches(q: string, all: boolean, limit = MAX_RESULTS): AirportMatch[] {
  const idx = airportIndex(all ? 'all' : 'min');
  const hits = engine(idx).search(q);
  const scored = hits.slice(0, 200).map((h) => {
    const a = idx.list[h.id as number]!;
    return { a, score: h.score + boost(a, q) };
  });
  scored.sort((x, y) => y.score - x.score);
  return scored.slice(0, limit).map(({ a, score }) => match(a, score, 'fuzzy'));
}

/** Scheduled-service airports (default index) nearest to a point, within `radiusKm`. */
export function nearestScheduled(lat: number, lng: number, n = 5, radiusKm = NEAREST_RADIUS_KM): { a: AirportRecord; km: number }[] {
  const idx = airportIndex('min');
  const out: { a: AirportRecord; km: number }[] = [];
  for (const a of idx.list) {
    if (!a.scheduledService) continue;
    if (Math.abs(a.lat - lat) > 2 || distanceKm([lng, lat], [a.lng, a.lat]) > radiusKm) continue;
    out.push({ a, km: distanceKm([lng, lat], [a.lng, a.lat]) });
  }
  return out.sort((x, y) => x.km - y.km).slice(0, n);
}

export interface SearchDeps {
  photon: (q: string, osmTag?: string) => Promise<Place[]>;
  nominatim: (q: string) => Promise<Place[]>;
}

const defaultDeps: SearchDeps = {
  photon: (q, osmTag) => photonSearch(q, { limit: 8, ...(osmTag ? { osmTag } : {}) }),
  nominatim: (q) => nominatimSearch(q, 3),
};

export interface SearchResult {
  results: AirportMatch[];
  metro: { name: string; codes: string[] } | null;
  providers: Record<string, ProviderRun>;
}

const bundled = (count: number): ProviderRun => ({ status: { ok: true, count, ms: 0, age_s: 0 }, okAt: Date.now() });

/** Photon aerodromes → the local airport within 5 km of each (re-ranked by the local boosts). */
function reRankAerodromes(places: readonly Place[], q: string): AirportMatch[] {
  const idx = airportIndex('all');
  const out = new Map<string, AirportMatch>();
  for (const p of places) {
    let best: AirportRecord | null = null;
    let bestKm = 5;
    for (const a of idx.list) {
      if (Math.abs(a.lat - p.lat) > 0.1) continue;
      const km = distanceKm([p.lng, p.lat], [a.lng, a.lat]);
      if (km < bestKm) {
        best = a;
        bestKm = km;
      }
    }
    if (best && !out.has(best.ident)) out.set(best.ident, match(best, 10 + boost(best, q) - bestKm, 'photon'));
  }
  return [...out.values()].sort((x, y) => y.score - x.score);
}

export async function searchAirports(q: string, opts: { all: boolean; submit: boolean }, deps: SearchDeps = defaultDeps): Promise<SearchResult> {
  const query = q.trim();
  const providers: Record<string, ProviderRun> = {};
  const idx = airportIndex(opts.all ? 'all' : 'min');
  providers.ourairports = bundled(idx.list.length);

  const metroGroup = metroFor(query);
  if (metroGroup) {
    const members = metroGroup.airports.map((c) => findAirport(c)).filter((a): a is AirportRecord => a !== null);
    if (members.length) {
      return {
        results: members.map((a, i) => match(a, 50 - i, 'metro')),
        metro: { name: metroGroup.name, codes: members.map((a) => a.iata ?? a.ident) },
        providers,
      };
    }
  }

  const seen = new Set<string>();
  const results: AirportMatch[] = [];
  const push = (list: AirportMatch[]) => {
    for (const m of list) {
      if (results.length >= MAX_RESULTS || seen.has(m.ident)) continue;
      seen.add(m.ident);
      results.push(m);
    }
  };
  push(exactMatches(query, opts.all));
  push(fuzzyMatches(query, opts.all));
  if (results.length || query.length < 3) return { results, metro: null, providers };

  // No local match: Photon aerodromes, re-ranked against the local index.
  const aero = await runProvider(() => deps.photon(query, 'aeroway:aerodrome'), (r) => r.length, { allowEmpty: true });
  providers.photon = aero.run;
  push(reRankAerodromes(aero.result ?? [], query));
  if (results.length) return { results, metro: null, providers };

  // A place name: geocode it, then the nearest scheduled-service airports within 150 km.
  const place = await runProvider(() => deps.photon(query), (r) => r.length, { allowEmpty: true });
  providers.photon = { status: { ...place.run.status, ms: aero.run.status.ms + place.run.status.ms }, okAt: place.run.okAt ?? aero.run.okAt };
  let origin: { p: Place; by: MatchedBy } | null = place.result?.[0] ? { p: place.result[0], by: 'photon' } : null;
  if (!origin && opts.submit) {
    const nom = await runProvider(() => deps.nominatim(query), (r) => r.length, { allowEmpty: true });
    providers.nominatim = nom.run;
    if (nom.result?.[0]) origin = { p: nom.result[0], by: 'nominatim' };
  }
  if (origin) push(nearestScheduled(origin.p.lat, origin.p.lng).map(({ a, km }) => match(a, 20 - km / 10, origin.by)));
  return { results, metro: null, providers };
}
