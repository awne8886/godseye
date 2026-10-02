/**
 * Air quality: Open-Meteo Air Quality API (CAMS model, `current=pm2_5,us_aqi`) at a fixed set of
 * world cities, or at a 6×6 grid inside a requested bbox. Open-Meteo's free tier is
 * non-commercial, so it runs only with capability `openmeteo` (off when COMMERCIAL_DEPLOYMENT).
 * Values are CAMS model estimates for the grid cell, not station measurements: `station` is the
 * sampling label, and the card says "modelled". Owner: layers-hazards. Server-only.
 *
 * Probed 2026-09-30: single point 200 in 0.82 s; multi-location (comma lists) answers a JSON array
 * in 0.81 s; CORS `*`; `current.time` is a zone-less GMT hour → normalizeUtc().
 * OpenAQ v3 / WAQI keyed upgrades are not implemented (no keys to verify them with), so they are
 * neither offered as capabilities nor reported as providers.
 */
import 'server-only';
import { hasCapability } from '@/lib/capabilities';
import { runProvider, skippedProvider, type ProviderRun } from '@/lib/feeds';
import { normalizeUtc } from '@/lib/freshness';
import { httpJson } from '@/lib/http';
import { providerBucket } from '@/lib/ratelimit';
import type { AirQuality } from '@/lib/types';
import { newestObservation, type Collected } from './collected';
import { lookup } from './lookup';

export const AQ_ATTRIBUTION = [
  { text: 'Air quality: Open-Meteo Air Quality API (Copernicus Atmosphere Monitoring Service model data)', url: 'https://open-meteo.com/en/docs/air-quality-api', licence: 'CC BY 4.0 (non-commercial free tier)' },
];

/** Sampling points for the global view (city centres; the values are modelled for each grid cell). */
export const AQ_CITIES: readonly [string, number, number][] = [
  ['London', 51.507, -0.128], ['Paris', 48.857, 2.352], ['Berlin', 52.52, 13.405], ['Madrid', 40.417, -3.704],
  ['Rome', 41.903, 12.496], ['Warsaw', 52.23, 21.012], ['Kyiv', 50.45, 30.523], ['Moscow', 55.756, 37.617],
  ['Istanbul', 41.008, 28.978], ['Cairo', 30.044, 31.236], ['Lagos', 6.524, 3.379], ['Kinshasa', -4.441, 15.266],
  ['Nairobi', -1.292, 36.822], ['Johannesburg', -26.204, 28.047], ['Addis Ababa', 9.03, 38.74], ['Casablanca', 33.573, -7.59],
  ['Riyadh', 24.713, 46.675], ['Tehran', 35.689, 51.389], ['Baghdad', 33.315, 44.366], ['Dubai', 25.205, 55.271],
  ['Karachi', 24.861, 67.01], ['Delhi', 28.614, 77.209], ['Mumbai', 19.076, 72.878], ['Kolkata', 22.573, 88.364],
  ['Dhaka', 23.81, 90.413], ['Kathmandu', 27.717, 85.324], ['Bangkok', 13.756, 100.502], ['Jakarta', -6.208, 106.846],
  ['Singapore', 1.352, 103.82], ['Manila', 14.6, 120.984], ['Hanoi', 21.028, 105.854], ['Beijing', 39.904, 116.407],
  ['Shanghai', 31.23, 121.474], ['Chengdu', 30.573, 104.066], ['Guangzhou', 23.129, 113.264], ['Hong Kong', 22.319, 114.169],
  ['Seoul', 37.567, 126.978], ['Tokyo', 35.676, 139.65], ['Ulaanbaatar', 47.886, 106.906], ['Almaty', 43.238, 76.889],
  ['Tashkent', 41.299, 69.24], ['Sydney', -33.869, 151.209], ['Melbourne', -37.814, 144.963], ['Auckland', -36.848, 174.763],
  ['New York', 40.713, -74.006], ['Los Angeles', 34.052, -118.244], ['Chicago', 41.878, -87.63], ['Houston', 29.76, -95.37],
  ['Toronto', 43.653, -79.383], ['Vancouver', 49.283, -123.121], ['Mexico City', 19.433, -99.133], ['Bogotá', 4.711, -74.072],
  ['Lima', -12.046, -77.043], ['Santiago', -33.449, -70.669], ['São Paulo', -23.551, -46.633], ['Buenos Aires', -34.604, -58.382],
  ['Anchorage', 61.218, -149.9], ['Reykjavík', 64.147, -21.942], ['Honolulu', 21.307, -157.858], ['Perth', -31.95, 115.861],
];

interface OmPoint {
  latitude?: number;
  longitude?: number;
  current?: { time?: string; pm2_5?: number | null; us_aqi?: number | null };
}

const AQ_BASE = 'https://air-quality-api.open-meteo.com/v1/air-quality';

export function aqUrl(points: readonly (readonly [number, number])[]): string {
  const lat = points.map((p) => p[0].toFixed(3)).join(',');
  const lng = points.map((p) => p[1].toFixed(3)).join(',');
  return `${AQ_BASE}?latitude=${lat}&longitude=${lng}&current=pm2_5,us_aqi&timezone=GMT`;
}

/** Map Open-Meteo's answer (object for one point, array for several) back onto the sampling points. */
export function normalizeOpenMeteo(body: OmPoint | OmPoint[], points: readonly (readonly [string | null, number, number])[]): AirQuality[] {
  const arr = Array.isArray(body) ? body : [body];
  const out: AirQuality[] = [];
  arr.forEach((p, i) => {
    const pt = points[i];
    const c = p.current;
    if (!pt || !c) return;
    const pm25 = typeof c.pm2_5 === 'number' ? c.pm2_5 : null;
    const usAqi = typeof c.us_aqi === 'number' ? c.us_aqi : null;
    if (pm25 === null && usAqi === null) return;
    const lat = typeof p.latitude === 'number' ? p.latitude : pt[1];
    const lng = typeof p.longitude === 'number' ? p.longitude : pt[2];
    out.push({
      id: `om-${pt[1].toFixed(2)},${pt[2].toFixed(2)}`,
      lat: Math.round(lat * 1000) / 1000,
      lng: Math.round(lng * 1000) / 1000,
      observedAt: normalizeUtc(c.time ?? null),
      source: 'open-meteo',
      pm25,
      usAqi,
      station: pt[0],
      provider: 'Open-Meteo',
    });
  });
  return out;
}

/** 6×6 cell-centre grid inside [w,s,e,n] (handles an antimeridian-crossing box). */
export function gridPoints([w, s, e, n]: readonly [number, number, number, number], per = 6): [null, number, number][] {
  const width = e >= w ? e - w : e + 360 - w;
  const out: [null, number, number][] = [];
  for (let i = 0; i < per; i++) {
    for (let j = 0; j < per; j++) {
      const lat = s + ((n - s) * (i + 0.5)) / per;
      let lng = w + (width * (j + 0.5)) / per;
      if (lng > 180) lng -= 360;
      out.push([null, Math.round(lat * 1000) / 1000, Math.round(lng * 1000) / 1000]);
    }
  }
  return out;
}

export interface AqData extends Collected<AirQuality> {
  sampling: 'cities' | 'grid';
}

/** Round a bbox outward to whole degrees so nearby viewports share one cached answer. */
export function quantiseBbox([w, s, e, n]: readonly [number, number, number, number]): [number, number, number, number] {
  return [Math.max(-180, Math.floor(w)), Math.max(-90, Math.floor(s)), Math.min(180, Math.ceil(e)), Math.min(90, Math.ceil(n))];
}

export async function airQuality(bbox: [number, number, number, number] | null) {
  const q = bbox ? quantiseBbox(bbox) : null;
  const key = q ? `air-quality:grid:${q.join(',')}` : 'air-quality:cities';
  return lookup<AqData>(key, {
    feed: 'air-quality',
    ttlMs: 30 * 60_000,
    attribution: AQ_ATTRIBUTION,
    note: 'Modelled (CAMS) values at sampling points, not station measurements',
    isEmpty: (d) => !d.answered,
    gates: ['openmeteo'],
    run: async (signal) => {
      const providers: Record<string, ProviderRun> = {};
      const points: readonly (readonly [string | null, number, number])[] = q ? gridPoints(q) : AQ_CITIES;
      if (!hasCapability('openmeteo')) {
        providers['open-meteo'] = skippedProvider('licence');
        return { data: { items: [], answered: false, sampling: q ? 'grid' : 'cities' }, providers };
      }
      const { result, run } = await runProvider(
        async () => {
          const res = await httpJson<OmPoint | OmPoint[]>(aqUrl(points.map((p) => [p[1], p[2]] as const)), {
            signal,
            timeoutMs: 15_000,
            limiter: providerBucket('open-meteo-aq', 1, 2),
          });
          return normalizeOpenMeteo(res.data ?? [], points);
        },
        (r) => r.length,
      );
      providers['open-meteo'] = run;
      const items = result ?? [];
      return { data: { items, answered: run.status.ok, sampling: q ? 'grid' : 'cities' }, providers, observedAt: newestObservation(items) };
    },
  });
}
