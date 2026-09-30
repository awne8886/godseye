/**
 * Country label points from Natural Earth 1:50m admin-0 (`LABEL_X`/`LABEL_Y`, public domain,
 * prepared 2026-09-30). Used ONLY where an upstream gives a country and nothing finer (Feodo
 * country codes, IODA/Cloudflare country outages, attack-origin shares): such points carry
 * `geoPrecision: 'country-centroid'` and the card says so. Owner: layers-threats-network. Isomorphic.
 */
import table from './country-centroids.json';

type Row = [lng: number, lat: number, name: string, iso3: string];
const BY_ISO2 = table as unknown as Record<string, Row>;
const BY_ISO3 = new Map<string, string>(Object.entries(BY_ISO2).map(([iso2, r]) => [r[3], iso2]));

export interface CountryPoint {
  iso2: string;
  iso3: string;
  name: string;
  lng: number;
  lat: number;
}

export function countryByIso2(code: string | null | undefined): CountryPoint | null {
  if (!code) return null;
  const iso2 = code.trim().toUpperCase();
  const r = BY_ISO2[iso2];
  return r ? { iso2, iso3: r[3], name: r[2], lng: r[0], lat: r[1] } : null;
}

export function countryByIso3(code: string | null | undefined): CountryPoint | null {
  if (!code) return null;
  const iso2 = BY_ISO3.get(code.trim().toUpperCase());
  return iso2 ? countryByIso2(iso2) : null;
}
