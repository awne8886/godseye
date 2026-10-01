/**
 * Region Dossier for a point: reverse geocode (Photon, then the queued Nominatim via
 * src/lib/geocode.ts only), Wikidata country facts (SPARQL by ISO 3166-1 alpha-2, current head of
 * state only), a Wikipedia summary, Open-Meteo current weather (when the `openmeteo` capability is
 * on — non-commercial free tier) and live layers within 150 km read in-process.
 * Probed 2026-09-30: Photon reverse 200 (3.3 s), Wikipedia REST summary 200 (0.55 s, CORS *),
 * Wikidata SPARQL 200 (0.84 s), Open-Meteo timed out twice from the shared build egress (the
 * dossier then shows weather as unavailable, never invented).
 * Owner: panels-alerts-markets-dossier-graph. Server-only.
 */
import 'server-only';
import { runProvider, skippedProvider, type FeedData, type ProviderRun } from '@/lib/feeds';
import { hasCapability } from '@/lib/capabilities';
import { normalizeUtc } from '@/lib/freshness';
import { OSM_ATTRIBUTION, nominatimReverse, photonReverse } from '@/lib/geocode';
import { getJson } from './get-json';
import { providerBucket } from '@/lib/ratelimit';
import type { Place, RegionDossierResponse } from '@/lib/types';

type Country = NonNullable<RegionDossierResponse['country']>;
type Brief = NonNullable<RegionDossierResponse['brief']>;
type Weather = NonNullable<RegionDossierResponse['weather']>;

export interface DossierStatic {
  location: RegionDossierResponse['location'];
  country: Country | null;
  brief: Brief | null;
  weather: Weather | null;
}

interface SparqlBinding {
  [k: string]: { value: string } | undefined;
}

/** Wikidata country facts; the population is the best-rank P1082 statement with its P585 date. */
export function countrySparql(iso2: string): string {
  return `SELECT ?c ?cLabel ?capitalLabel ?pop ?popDate ?area ?hosLabel ?regionLabel (GROUP_CONCAT(DISTINCT ?langLabel;separator="|") AS ?langs) WHERE { ?c wdt:P297 "${iso2}". OPTIONAL{?c wdt:P36 ?capital} OPTIONAL{?c p:P1082 ?popSt. ?popSt ps:P1082 ?pop; a wikibase:BestRank. OPTIONAL{?popSt pq:P585 ?popDate}} OPTIONAL{?c wdt:P2046 ?area} OPTIONAL{?c p:P35 ?st. ?st ps:P35 ?hos. FILTER NOT EXISTS{?st pq:P582 ?e}} OPTIONAL{?c wdt:P30 ?region} OPTIONAL{?c wdt:P37 ?lang. ?lang rdfs:label ?langLabel. FILTER(LANG(?langLabel)="en")} SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } GROUP BY ?c ?cLabel ?capitalLabel ?pop ?popDate ?area ?hosLabel ?regionLabel LIMIT 20`;
}

export function parseCountry(body: { results?: { bindings?: SparqlBinding[] } }, iso2: string): Country | null {
  const rows = body.results?.bindings ?? [];
  const b = rows[0];
  if (!b?.cLabel) return null;
  const num = (row: SparqlBinding, k: string) => {
    const v = row[k]?.value;
    const x = v === undefined ? NaN : Number(v);
    return Number.isFinite(x) ? x : null;
  };
  const n = (k: string) => num(b, k);
  const qid = b.c?.value.match(/(Q\d+)$/)?.[1] ?? null;
  // Several best-rank population statements: the one with the latest point-in-time wins.
  const yearOf = (row: SparqlBinding) => {
    const y = Number(row.popDate?.value.match(/^(\d{4})-/)?.[1]);
    return Number.isFinite(y) && y > 0 ? y : null;
  };
  const popRow = rows.filter((r) => num(r, 'pop') !== null).sort((x, y) => (yearOf(y) ?? 0) - (yearOf(x) ?? 0))[0] ?? null;
  const population = popRow ? num(popRow, 'pop') : null;
  return {
    name: b.cLabel.value,
    iso2,
    capital: b.capitalLabel?.value ?? null,
    population,
    populationSource: population === null || !popRow ? null : { name: 'Wikidata P1082', year: yearOf(popRow), url: qid ? `https://www.wikidata.org/wiki/${qid}#P1082` : 'https://www.wikidata.org/' },
    areaKm2: n('area'),
    languages: (b.langs?.value ?? '').split('|').filter(Boolean),
    region: b.regionLabel?.value ?? null,
    headOfState: b.hosLabel?.value && !/^Q\d+$/.test(b.hosLabel.value) ? { name: b.hosLabel.value, position: 'Head of state (Wikidata P35)' } : null,
    wikidataId: qid,
  };
}

export function parseWikiSummary(body: { title?: string; extract?: string; thumbnail?: { source?: string }; content_urls?: { desktop?: { page?: string } }; type?: string }): Brief | null {
  if (!body.title || !body.extract || body.type === 'disambiguation') return null;
  const url = body.content_urls?.desktop?.page;
  if (!url || !/^https:\/\//.test(url)) return null;
  const thumb = body.thumbnail?.source;
  return { title: body.title, extract: body.extract.slice(0, 1200), thumbnailUrl: thumb && /^https:\/\//.test(thumb) ? thumb : null, url };
}

export function parseOpenMeteo(body: { current?: { time?: string; temperature_2m?: number; wind_speed_10m?: number; weather_code?: number } }): Weather | null {
  const c = body.current;
  if (!c) return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  // Open-Meteo `current.time` is zone-less GMT when no timezone is requested.
  return { temperatureC: num(c.temperature_2m), windKmh: num(c.wind_speed_10m), code: num(c.weather_code), observedAt: normalizeUtc(c.time) };
}

/**
 * World Bank WDI total population (SP.POP.TOTL), most recent non-empty year (`mrnev=1`). Keyless,
 * CC BY 4.0, CORS *. Probed 2026-10-01: UA → 200 in 0.34 s, `{date:"2025", value:38980376}`;
 * TW (not a WDI economy) → 200 with a null page (no figure; Wikidata is used instead).
 */
export function worldBankPopulationUrl(iso2: string): string {
  return `https://api.worldbank.org/v2/country/${iso2}/indicator/SP.POP.TOTL?format=json&mrnev=1`;
}

export function parseWorldBankPopulation(body: unknown): { value: number; year: number } | null {
  if (!Array.isArray(body) || body.length < 2) throw new Error('parse');
  const rows: unknown = body[1];
  if (rows === null) return null; // the economy is not covered
  if (!Array.isArray(rows)) throw new Error('parse');
  for (const r of rows as { date?: unknown; value?: unknown }[]) {
    if (typeof r?.value === 'number' && Number.isFinite(r.value) && typeof r.date === 'string' && /^\d{4}$/.test(r.date)) return { value: r.value, year: Number(r.date) };
  }
  return null;
}

/** Prefer the dated World Bank figure; keep Wikidata's (with its own year) when the Bank has none. */
export function withPopulation(country: Country | null, wb: { value: number; year: number } | null, iso2: string): Country | null {
  if (!country || !wb) return country;
  return { ...country, population: wb.value, populationSource: { name: 'World Bank (SP.POP.TOTL)', year: wb.year, url: `https://data.worldbank.org/indicator/SP.POP.TOTL?locations=${iso2}` } };
}

const wikiLimiter = () => providerBucket('wikimedia', 5, 5);
const worldBankLimiter = () => providerBucket('worldbank', 2, 4);

export async function runDossierStatic(lat: number, lng: number, signal?: AbortSignal): Promise<FeedData<DossierStatic>> {
  const providers: Record<string, ProviderRun> = {};
  // 1) Reverse geocode: Photon first; the Nominatim queue only when Photon has nothing.
  const photon = await runProvider(() => photonReverse(lat, lng), (p) => (p ? 1 : 0));
  providers.photon = photon.run;
  let place: Place | null = photon.result;
  if (!place) {
    const nom = await runProvider(() => nominatimReverse(lat, lng, 10), (p) => (p ? 1 : 0));
    providers.nominatim = nom.run;
    place = nom.result;
  }
  const iso2 = place?.countryCode ? place.countryCode.toUpperCase() : null;
  const location = place ? { displayName: place.label || place.name, countryCode: iso2, attribution: OSM_ATTRIBUTION } : null;

  const validIso = iso2 && /^[A-Z]{2}$/.test(iso2) ? iso2 : null;
  const [country, weather, population] = await Promise.all([
    validIso
      ? runProvider(
          async () => parseCountry((await getJson<{ results?: { bindings?: SparqlBinding[] } }>(`https://query.wikidata.org/sparql?query=${encodeURIComponent(countrySparql(validIso))}`, { headers: { Accept: 'application/sparql-results+json' }, timeoutMs: 12_000, signal, limiter: wikiLimiter() })).data, validIso),
          (c) => (c ? 1 : 0),
        )
      : null,
    hasCapability('openmeteo')
      ? runProvider(
          async () => parseOpenMeteo((await getJson<Parameters<typeof parseOpenMeteo>[0]>(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}&current=temperature_2m,wind_speed_10m,weather_code`, { timeoutMs: 8000, retries: 0, signal, limiter: providerBucket('open-meteo', 2, 2) })).data),
          (w) => (w ? 1 : 0),
        )
      : null,
    validIso
      ? runProvider(
          async () => parseWorldBankPopulation((await getJson<unknown>(worldBankPopulationUrl(validIso), { timeoutMs: 8000, retries: 1, signal, limiter: worldBankLimiter() })).data),
          (p) => (p ? 1 : 0),
          // Economies the Bank does not cover (e.g. Taiwan) answer with no rows: truthfully none.
          { allowEmpty: true },
        )
      : null,
  ]);
  if (country) providers.wikidata = country.run;
  if (population) providers.worldbank = population.run;
  providers['open-meteo'] = weather ? weather.run : skippedProvider('licence');
  const countryFacts = validIso ? withPopulation(country?.result ?? null, population?.result ?? null, validIso) : null;

  // 2) Brief: the country's English article (a reverse-geocoded point is often a building whose
  // local-language name has no article); the place name only when no country was resolved.
  const title = country?.result?.name ?? (place?.name && !/^\d/.test(place.name) ? place.name : null);
  let brief: Brief | null = null;
  if (title) {
    const w = await runProvider(
      async () => parseWikiSummary((await getJson<Parameters<typeof parseWikiSummary>[0]>(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, { timeoutMs: 8000, signal, limiter: wikiLimiter() })).data),
      (b) => (b ? 1 : 0),
    );
    providers.wikipedia = w.run;
    brief = w.result;
  }
  return { data: { location, country: countryFacts, brief, weather: weather?.result ?? null }, providers, observedAt: null };
}
