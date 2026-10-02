/**
 * Country-risk geometry: what the choropleth draws, and why some rows are not drawn (R3 round-4
 * MINOR-8: the rail counted 207 rows while 166 shapes were drawn). Every row with an INFORM score is
 * drawn: as its Natural Earth 1:110m outline when there is one, otherwise (small and island states
 * such as Bahrain, Malta or Samoa have no 1:110m outline) as a point at its Natural Earth label
 * point. Rows with no INFORM score (World Bank WGI value only) have nothing to shade and are not
 * drawn. The rail count is `drawn`. Owner: layers-threats-network. Pure; isomorphic.
 */
import type { CountryRisk } from '@/lib/types';
import { countryByIso3, type CountryPoint } from '../shared/country';

export interface RiskGeometry {
  /** Scored countries with a 1:110m outline (properties: id = ISO3, score). */
  polygons: GeoJSON.FeatureCollection;
  /** Scored countries without an outline, at their label point (properties: id, score). */
  points: GeoJSON.FeatureCollection;
  /** polygons + points: the number the rail shows. */
  drawn: number;
  /** Rows without an INFORM score (WGI only): listed by the API, not shaded. */
  unscored: number;
  /** Scored rows with neither an outline nor a label point (ISO3). */
  noGeometry: string[];
}

export function buildRiskGeometry(
  items: readonly CountryRisk[],
  shapes: GeoJSON.FeatureCollection,
  labelPoint: (iso3: string) => CountryPoint | null = countryByIso3,
): RiskGeometry {
  const byIso = new Map(items.map((r) => [r.iso3, r]));
  const outlined = new Set<string>();
  const polygons: GeoJSON.Feature[] = [];
  for (const f of shapes.features) {
    const iso3 = String(f.properties?.iso3 ?? '');
    const r = byIso.get(iso3);
    if (!r || r.score === null || outlined.has(iso3)) continue;
    outlined.add(iso3);
    polygons.push({ ...f, properties: { id: iso3, score: r.score } });
  }
  const points: GeoJSON.Feature[] = [];
  const noGeometry: string[] = [];
  let unscored = 0;
  for (const r of byIso.values()) {
    if (r.score === null) {
      unscored++;
      continue;
    }
    if (outlined.has(r.iso3)) continue;
    const p = labelPoint(r.iso3);
    if (!p) {
      noGeometry.push(r.iso3);
      continue;
    }
    points.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: { id: r.iso3, score: r.score } });
  }
  return {
    polygons: { type: 'FeatureCollection', features: polygons },
    points: { type: 'FeatureCollection', features: points },
    drawn: polygons.length + points.length,
    unscored,
    noGeometry: noGeometry.sort(),
  };
}
