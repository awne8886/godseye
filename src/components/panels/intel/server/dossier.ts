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

export function countrySparql(iso2: string): string {
  return `SELECT ?c ?cLabel ?capitalLabel ?pop ?area ?hosLabel ?regionLabel (GROUP_CONCAT(DISTINCT ?langLabel;separator="|") AS ?langs) WHERE { ?c wdt:P297 "${iso2}". OPTIONAL{?c wdt:P36 ?capital} OPTIONAL{?c wdt:P1082 ?pop} OPTIONAL{?c wdt:P2046 ?area} OPTIONAL{?c p:P35 ?st. ?st ps:P35 ?hos. FILTER NOT EXISTS{?st pq:P582 ?e}} OPTIONAL{?c wdt:P30 ?region} OPTIONAL{?c wdt:P37 ?lang. ?lang rdfs:label ?langLabel. FILTER(LANG(?langLabel)="en")} SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } GROUP BY ?c ?cLabel ?capitalLabel ?pop ?area ?hosLabel ?regionLabel LIMIT 5`;
}

export function parseCountry(body: { results?: { bindings?: SparqlBinding[] } }, iso2: string): Country | null {
  const b = body.results?.bindings?.[0];
  if (!b?.cLabel) return null;
  const n = (k: string) => {
    const v = b[k]?.value;
    const x = v === undefined ? NaN : Number(v);
    return Number.isFinite(x) ? x : null;
  };
  const qid = b.c?.value.match(/(Q\d+)$/)?.[1] ?? null;
  return {
    name: b.cLabel.value,
    iso2,
    capital: b.capitalLabel?.value ?? null,
    population: n('pop'),
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

const wikiLimiter = () => providerBucket('wikimedia', 5, 5);

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

  const [country, weather] = await Promise.all([
    iso2 && /^[A-Z]{2}$/.test(iso2)
      ? runProvider(
          async () => parseCountry((await getJson<{ results?: { bindings?: SparqlBinding[] } }>(`https://query.wikidata.org/sparql?query=${encodeURIComponent(countrySparql(iso2))}`, { headers: { Accept: 'application/sparql-results+json' }, timeoutMs: 12_000, signal, limiter: wikiLimiter() })).data, iso2),
          (c) => (c ? 1 : 0),
        )
      : null,
    hasCapability('openmeteo')
      ? runProvider(
          async () => parseOpenMeteo((await getJson<Parameters<typeof parseOpenMeteo>[0]>(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}&current=temperature_2m,wind_speed_10m,weather_code`, { timeoutMs: 8000, retries: 0, signal, limiter: providerBucket('open-meteo', 2, 2) })).data),
          (w) => (w ? 1 : 0),
        )
      : null,
  ]);
  if (country) providers.wikidata = country.run;
  providers['open-meteo'] = weather ? weather.run : skippedProvider('licence');

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
  return { data: { location, country: country?.result ?? null, brief, weather: weather?.result ?? null }, providers, observedAt: null };
}
