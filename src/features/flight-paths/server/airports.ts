/**
 * Airport resolution for GET /api/airports/search (§8): exact IATA → exact ICAO → gps_code/ident →
 * metro group → MiniSearch fuzzy (name, municipality, keywords, region, country) with boosts
 * (large +3, medium +2, scheduled +3, IATA +1, exact municipality +2) → Photon aerodromes re-ranked
 * against the local index → Photon place / Nominatim (explicit submits only) → nearest 5
 * scheduled-service airports within 150 km. Server-only.
 *
 * Round 5 B2 (the palette planned BWU for "Sydney", AHN for "Athens", Torino's LIMA for "Lima"):
 *  - a fuzzy hit that carries the typed name as whole words (`nameMatch`) ranks above every hit that
 *    does not, and among those the city's main airport comes first (`compareMain`): scheduled
 *    service, then size (large > medium > small), then an IATA code, then how it carries the name
 *    (its town > elsewhere in its municipality > its airport name or a keyword: "Sofia" is SOF, not
 *    Tenerife Sur's keyword "Reina Sofía"), then VRS services calling there — the MiniSearch score
 *    (20–120, which used to swamp the ≤ +9 boosts) only breaks the remaining ties;
 *  - an ordinary word is not an airport code: a 4+-letter word typed in lower or mixed case ("Lima",
 *    "Bali") matches an ICAO code / ident only when that airport has scheduled service ("egll" still
 *    finds EGLL); typed in capitals it is a code ("LIMA" is Torino-Aeritalia);
 *  - a word that is also a code ranks the airport bearing the name first when `exactOrName` says the
 *    name wins ("Goa" → GOI before GOA Genoa, "Leh" → IXL before Le Havre's LEH), as the palette does.
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
import { nameMatch, nameRank, wordNotCode } from '../lib/names';
import { compareRanked, exactOrName, mainAmong } from '../lib/place-rank';
import { airportIndex, findAirport, servicesAt, type AirportIndex, type AirportRecord } from './data';

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
  const { gps: _g, keywords, longestRunwayM: _r, ...rest } = a;
  return { ...rest, keywords: keywords || null, services: servicesAt(a.icao), score: Math.round(score * 100) / 100, matchedBy };
};

/** Exact code matches in resolve order (IATA → ICAO → gps_code/ident), default index then all. */
export function exactMatches(q: string, all: boolean): AirportMatch[] {
  const c = q.trim().toUpperCase();
  if (!/^[A-Z0-9-]{2,10}$/.test(c)) return [];
  const word = wordNotCode(q);
  const out: AirportMatch[] = [];
  const seen = new Set<string>();
  const add = (a: AirportRecord | undefined, by: MatchedBy, score: number) => {
    if (a && !seen.has(a.ident) && (!word || a.scheduledService)) {
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

export interface Scored {
  m: AirportMatch;
  /** MiniSearch score + `boost`. */
  score: number;
  /** How the hit carries the typed name (`nameRank`: 5 its town … 1 a keyword, 0 not at all). */
  rank: number;
}

/**
 * Fuzzy order (round 5 B2): hits carrying the typed name as whole words first; among those the
 * city's main airport (`compareRanked`: scheduled service → size → IATA code → town > part of a town
 * name > municipality > airport name > keyword → VRS services calling there); then the score.
 */
export function compareFuzzy(x: Scored, y: Scored): number {
  const [nx, ny] = [x.rank > 0, y.rank > 0];
  if (nx !== ny) return nx ? -1 : 1;
  return (nx ? compareRanked(x.m, x.rank, y.m, y.rank) : 0) || y.score - x.score;
}

export function fuzzyMatches(q: string, all: boolean, limit = MAX_RESULTS): AirportMatch[] {
  const idx = airportIndex(all ? 'all' : 'min');
  const hits = engine(idx).search(q);
  const scored: Scored[] = hits.slice(0, 200).map((h) => {
    const a = idx.list[h.id as number]!;
    const score = h.score + boost(a, q);
    return { m: match(a, score, 'fuzzy'), score, rank: nameRank(a, q) };
  });
  scored.sort(compareFuzzy);
  const out = scored.map((s) => s.m);
  // The busiest same-class airport of the area named for the place leads (`mainAmong`: Bucharest → OTP).
  const named = scored.filter((s) => s.rank > 0).map((s) => s.m);
  const main = mainAmong(named, q);
  if (main && main !== out[0]) out.splice(out.indexOf(main), 1).forEach((m) => out.unshift(m));
  return out.slice(0, limit);
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
  /** The geocoded place the results are nearest to (only for the Photon/Nominatim place fallback). */
  place?: GeocodedPlace | null;
  providers: Record<string, ProviderRun>;
}

export interface GeocodedPlace {
  name: string;
  country: string | null;
  lat: number;
  lng: number;
  source: 'photon' | 'nominatim';
}

/** Country name for an ISO code from the bundled OurAirports countries, else the code itself. */
export function countryName(code: string | null): string | null {
  if (!code) return null;
  return airportIndex('min').list.find((a) => a.isoCountry === code && a.country)?.country ?? code;
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
  const exact = exactMatches(query, opts.all);
  const fuzzy = fuzzyMatches(query, opts.all);
  // "Goa", "Leh", "Sylt": the airport bearing the name before the code's namesake (as the palette decides).
  const named = fuzzy.filter((m) => nameMatch(m, query) !== null);
  if (exact[0] && exactOrName(exact[0], named[0] ?? null, query) === 'name') push(named);
  push(exact);
  push(fuzzy);
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
  if (!origin) return { results, metro: null, providers };
  const near = nearestScheduled(origin.p.lat, origin.p.lng);
  push(near.map(({ a, km }) => ({ ...match(a, 20 - km / 10, origin.by), distanceKm: Math.round(km * 10) / 10 })));
  // R4 m7: say which place the text was geocoded to, so "nearest to X" is never a silent guess.
  const geocoded: GeocodedPlace = { name: origin.p.name, country: countryName(origin.p.countryCode), lat: origin.p.lat, lng: origin.p.lng, source: origin.by === 'nominatim' ? 'nominatim' : 'photon' };
  return { results, metro: null, place: near.length ? geocoded : null, providers };
}
