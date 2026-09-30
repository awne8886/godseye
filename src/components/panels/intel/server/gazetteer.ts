/**
 * Offline gazetteer for geoparsing Live Alerts into pins. Coordinates are the settlement/region
 * centroid (OpenStreetMap/Wikipedia values, rounded to 0.01°); a country match is a country-level
 * pin, never presented as the event's exact location. The pin's `precision` and `method:
 * 'gazetteer'` are shown on the card. Most specific match wins (settlement > region > country), then
 * the earliest mention in the headline. Owner: panels-alerts-markets-dossier-graph. Isomorphic.
 */
import type { PlacePrecision } from '@/lib/types';

export interface GazetteerEntry {
  name: string;
  lat: number;
  lng: number;
  precision: PlacePrecision;
  /** Lower-case match terms (whole word). */
  terms: readonly string[];
}

const S = (name: string, lat: number, lng: number, ...terms: string[]): GazetteerEntry => ({ name, lat, lng, precision: 'settlement', terms: [name.toLowerCase(), ...terms] });
const R = (name: string, lat: number, lng: number, ...terms: string[]): GazetteerEntry => ({ name, lat, lng, precision: 'region', terms: [name.toLowerCase(), ...terms] });
const C = (name: string, lat: number, lng: number, ...terms: string[]): GazetteerEntry => ({ name, lat, lng, precision: 'country', terms: [name.toLowerCase(), ...terms] });

export const GAZETTEER: readonly GazetteerEntry[] = [
  // Ukraine / Russia
  S('Kyiv', 50.45, 30.52, 'kiev'), S('Kharkiv', 49.99, 36.23, 'kharkov'), S('Odesa', 46.48, 30.72, 'odessa'), S('Dnipro', 48.46, 35.05), S('Zaporizhzhia', 47.84, 35.14, 'zaporozhye'),
  S('Kherson', 46.64, 32.61), S('Mykolaiv', 46.97, 31.99), S('Lviv', 49.84, 24.03), S('Sumy', 50.91, 34.8), S('Pokrovsk', 48.28, 37.18), S('Kramatorsk', 48.72, 37.56),
  S('Donetsk', 48.0, 37.8), S('Luhansk', 48.57, 39.31), S('Bakhmut', 48.6, 38.0), S('Chernihiv', 51.49, 31.29), S('Poltava', 49.59, 34.55), S('Kryvyi Rih', 47.91, 33.39),
  S('Sevastopol', 44.62, 33.52), S('Belgorod', 50.6, 36.59), S('Kursk', 51.73, 36.19), S('Bryansk', 53.24, 34.36), S('Moscow', 55.76, 37.62), S('St Petersburg', 59.94, 30.31, 'saint petersburg', 'st. petersburg'),
  S('Novorossiysk', 44.72, 37.77), S('Rostov-on-Don', 47.23, 39.72, 'rostov'), S('Voronezh', 51.67, 39.18), S('Kazan', 55.79, 49.12),
  R('Crimea', 45.3, 34.4), R('Donbas', 48.3, 38.0, 'donbass'),
  // Middle East
  S('Gaza City', 31.5, 34.47), S('Khan Younis', 31.35, 34.3, 'khan yunis'), S('Rafah', 31.3, 34.25), S('Jenin', 32.46, 35.3), S('Nablus', 32.22, 35.26), S('Tel Aviv', 32.08, 34.78),
  S('Jerusalem', 31.78, 35.22), S('Haifa', 32.79, 34.99), S('Eilat', 29.56, 34.95), S('Beirut', 33.89, 35.5), S('Nabatieh', 33.38, 35.48), S('Tyre', 33.27, 35.2), S('Damascus', 33.51, 36.29),
  S('Aleppo', 36.2, 37.16), S('Idlib', 35.93, 36.63), S('Baghdad', 33.31, 44.36), S('Erbil', 36.19, 44.01), S('Mosul', 36.34, 43.13), S('Tehran', 35.69, 51.39), S('Isfahan', 32.65, 51.67),
  S('Sanaa', 15.37, 44.19, "sana'a"), S('Hodeidah', 14.8, 42.95), S('Aden', 12.79, 45.02), S('Riyadh', 24.71, 46.68), S('Doha', 25.29, 51.53), S('Dubai', 25.2, 55.27), S('Amman', 31.95, 35.93),
  R('Gaza Strip', 31.42, 34.37, 'gaza'), R('West Bank', 31.95, 35.25), R('Golan Heights', 33.0, 35.75, 'golan'), R('Strait of Hormuz', 26.57, 56.25, 'hormuz'), R('Red Sea', 20.0, 38.5), R('Bab el-Mandeb', 12.58, 43.33),
  // Asia-Pacific
  S('Taipei', 25.03, 121.57), S('Beijing', 39.9, 116.4), S('Shanghai', 31.23, 121.47), S('Hong Kong', 22.32, 114.17), S('Tokyo', 35.68, 139.69), S('Seoul', 37.57, 126.98), S('Pyongyang', 39.04, 125.76),
  S('Manila', 14.6, 120.98), S('New Delhi', 28.61, 77.21, 'delhi'), S('Mumbai', 19.08, 72.88), S('Islamabad', 33.68, 73.05), S('Karachi', 24.86, 67.0), S('Kabul', 34.53, 69.17), S('Dhaka', 23.81, 90.41),
  S('Yangon', 16.87, 96.2), S('Bangkok', 13.76, 100.5), S('Singapore', 1.35, 103.82), S('Jakarta', -6.21, 106.85),
  R('South China Sea', 12.0, 114.0), R('Kashmir', 34.08, 74.8), R('Taiwan Strait', 24.5, 119.5),
  // Africa
  S('Khartoum', 15.5, 32.56), S('El Fasher', 13.63, 25.35), S('Port Sudan', 19.62, 37.22), S('Mogadishu', 2.05, 45.32), S('Addis Ababa', 9.03, 38.74), S('Tripoli', 32.89, 13.19), S('Bamako', 12.64, -8.0),
  S('Niamey', 13.51, 2.11), S('Ouagadougou', 12.37, -1.52), S('Goma', -1.68, 29.23), S('Kinshasa', -4.44, 15.27), S('Lagos', 6.52, 3.38), S('Abuja', 9.08, 7.4), S('Nairobi', -1.29, 36.82), S('Cairo', 30.04, 31.24),
  R('Darfur', 13.5, 24.0), R('Sahel', 14.5, 0.0),
  // Europe / Americas
  S('Brussels', 50.85, 4.35), S('Warsaw', 52.23, 21.01), S('Berlin', 52.52, 13.4), S('Paris', 48.86, 2.35), S('London', 51.51, -0.13), S('Vilnius', 54.69, 25.28), S('Riga', 56.95, 24.11), S('Tallinn', 59.44, 24.75),
  S('Helsinki', 60.17, 24.94), S('Chisinau', 47.01, 28.86), S('Minsk', 53.9, 27.56), S('Tbilisi', 41.72, 44.79), S('Belgrade', 44.79, 20.45), S('Ankara', 39.93, 32.86), S('Istanbul', 41.01, 28.98),
  S('Washington', 38.9, -77.04, 'washington dc', 'washington, d.c.'), S('New York', 40.71, -74.01), S('Caracas', 10.49, -66.88), S('Bogota', 4.71, -74.07, 'bogotá'), S('Mexico City', 19.43, -99.13),
  S('Port-au-Prince', 18.59, -72.31), S('Havana', 23.11, -82.37),
  // Countries (centroids)
  C('Ukraine', 49.0, 31.4, 'ukrainian'), C('Russia', 61.5, 105.3, 'russian federation'), C('Israel', 31.05, 34.85), C('Lebanon', 33.85, 35.86), C('Syria', 34.8, 38.99), C('Iraq', 33.22, 43.68), C('Iran', 32.43, 53.69),
  C('Yemen', 15.55, 48.52), C('Saudi Arabia', 23.89, 45.08), C('Qatar', 25.35, 51.18), C('Jordan', 30.59, 36.24), C('Egypt', 26.82, 30.8), C('Turkey', 38.96, 35.24, 'türkiye', 'turkiye'), C('Sudan', 12.86, 30.22),
  C('Somalia', 5.15, 46.2), C('Ethiopia', 9.15, 40.49), C('Libya', 26.34, 17.23), C('Mali', 17.57, -4.0), C('Niger', 17.61, 8.08), C('Burkina Faso', 12.24, -1.56), C('Nigeria', 9.08, 8.68),
  C('Democratic Republic of the Congo', -4.04, 21.76, 'dr congo', 'drc'), C('China', 35.86, 104.2), C('Taiwan', 23.7, 120.96), C('Japan', 36.2, 138.25), C('North Korea', 40.34, 127.51), C('South Korea', 35.91, 127.77),
  C('India', 20.59, 78.96), C('Pakistan', 30.38, 69.35), C('Afghanistan', 33.94, 67.71), C('Myanmar', 21.91, 95.96), C('Philippines', 12.88, 121.77), C('Poland', 51.92, 19.15), C('Belarus', 53.71, 27.95),
  C('Moldova', 47.41, 28.37), C('Georgia', 42.32, 43.36), C('Armenia', 40.07, 45.04), C('Azerbaijan', 40.14, 47.58), C('Venezuela', 6.42, -66.59), C('Colombia', 4.57, -74.3), C('Haiti', 18.97, -72.29), C('Mexico', 23.63, -102.55),
];

const PRECISION_RANK: Record<PlacePrecision, number> = { settlement: 0, region: 1, country: 2 };

const COMPILED = GAZETTEER.map((e) => ({
  e,
  re: new RegExp(`(?<![\\p{L}\\p{N}])(?:${e.terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')).join('|')})(?![\\p{L}\\p{N}])`, 'iu'),
}));

export interface GeoMatch {
  name: string;
  lat: number;
  lng: number;
  precision: PlacePrecision;
  method: 'gazetteer';
}

/**
 * Most specific place mentioned in the headline (then the summary). Georgia the country is skipped
 * when the text says "Georgia" alongside a U.S. context word, since the state is far likelier.
 */
export function geoparse(headline: string, summary = ''): GeoMatch | null {
  for (const text of [headline, summary.slice(0, 600)]) {
    if (!text) continue;
    let best: { e: GazetteerEntry; at: number } | null = null;
    for (const { e, re } of COMPILED) {
      const m = re.exec(text);
      if (!m) continue;
      if (e.name === 'Georgia' && /\b(atlanta|u\.s\.|us state|governor)\b/i.test(text)) continue;
      if (!best || PRECISION_RANK[e.precision] < PRECISION_RANK[best.e.precision] || (e.precision === best.e.precision && m.index < best.at)) best = { e, at: m.index };
    }
    if (best) return { name: best.e.name, lat: best.e.lat, lng: best.e.lng, precision: best.e.precision, method: 'gazetteer' };
  }
  return null;
}
