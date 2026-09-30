/**
 * Severe-weather feed: NASA EONET v3, NWS active alerts (+ zone geometry), GDACS event list, NHC
 * current storms + forecast cones, Smithsonian GVP weekly volcano reports. Core feed (eager).
 * Owner: layers-hazards. Server-only.
 *
 * Probed 2026-09-30 (all 200): EONET 3.1 s (Content-Type rss+xml for JSON), NWS 0.7 s (152 alerts,
 * geometry null for 112), GDACS SEARCH 1.8 s (89 events; MAP → 400), NHC CurrentStorms 0.6 s,
 * NHC MapServer cone query 0.8 s, GVP RSS 0.6 s (ISO-8859-1).
 */
import 'server-only';
import { defineFeed, runProvider, type ProviderRun } from '@/lib/feeds';
import { httpJson, httpRequest, HttpError } from '@/lib/http';
import type { WeatherEvent } from '@/lib/types';
import { newestObservation } from './collected';
import { normalizeEonet, type EonetResponse } from './eonet-parse';
import { resolveZones } from './nws-zones';
import {
  GDACS_URL,
  GVP_URL,
  NHC_STORMS_URL,
  NWS_ALERTS_URL,
  coneQueryUrl,
  decodeXml,
  normalizeGdacs,
  normalizeGvp,
  normalizeNhc,
  normalizeNws,
  parseCone,
  zonesNeeded,
  type GdacsFeature,
  type NhcStorm,
  type NwsCollection,
} from './weather-parse';

export interface WeatherData {
  items: WeatherEvent[];
  unplacedAlerts: number;
  answered: boolean;
}

export const EONET_URL = 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=7';

export const WEATHER_ATTRIBUTION = [
  { text: 'Natural events: NASA EONET v3', url: 'https://eonet.gsfc.nasa.gov/', licence: 'NASA open data' },
  { text: 'US alerts: NOAA National Weather Service (api.weather.gov)', url: 'https://www.weather.gov/documentation/services-web-api', licence: 'Public domain' },
  { text: 'Global disasters: GDACS (European Commission JRC / UN OCHA)', url: 'https://www.gdacs.org/', licence: 'GDACS terms of use, attribution' },
  { text: 'Tropical cyclones: NOAA National Hurricane Center', url: 'https://www.nhc.noaa.gov/', licence: 'Public domain' },
  { text: 'Volcanoes: Smithsonian Institution Global Volcanism Program / USGS Weekly Volcanic Activity Report', url: 'https://volcano.si.edu/', licence: 'Smithsonian terms of use, attribution' },
];

type Geo = GeoJSON.Polygon | GeoJSON.MultiPolygon;

/** Drop EONET storms that NHC already reports (same storm name) so a cyclone is drawn once. */
export function dedupeStorms(eonet: WeatherEvent[], nhc: WeatherEvent[]): WeatherEvent[] {
  const names = nhc.map((s) => s.title.split(' ').pop()!.toLowerCase()).filter((n) => n.length > 2);
  if (!names.length) return eonet;
  return eonet.filter((e) => e.type !== 'severe_storm' || !names.some((n) => new RegExp(`\\b${n}\\b`, 'i').test(e.title)));
}

export const weatherFeed = defineFeed<WeatherData>({
  key: 'weather',
  ttlMs: 5 * 60_000,
  kind: 'live',
  attribution: WEATHER_ATTRIBUTION,
  eager: true,
  deadlineMs: 60_000,
  count: (d) => d.items.length,
  isEmpty: (d) => !d.answered,
  run: async ({ signal }) => {
    const providers: Record<string, ProviderRun> = {};
    let unplaced = 0;
    const [eonet, nws, gdacs, nhc, gvp] = await Promise.all([
      runProvider(async () => normalizeEonet((await httpJson<EonetResponse>(EONET_URL, { signal, timeoutMs: 20_000 })).data ?? {}, { skip: ['earthquakes', 'wildfires'] }), (r) => r.length),
      runProvider(
        async () => {
          const fc = (await httpJson<NwsCollection>(NWS_ALERTS_URL, { signal, timeoutMs: 20_000, headers: { accept: 'application/geo+json' } })).data ?? {};
          const { zones } = await resolveZones(zonesNeeded(fc), { signal, budget: 60 });
          const r = normalizeNws(fc, zones);
          unplaced = r.unplaced;
          return r.items;
        },
        (r) => r.length,
      ),
      runProvider(async () => normalizeGdacs((await httpJson<{ features?: GdacsFeature[] }>(GDACS_URL, { signal, timeoutMs: 20_000 })).data ?? {}), (r) => r.length),
      runProvider(
        async () => {
          const res = (await httpJson<{ activeStorms?: NhcStorm[] }>(NHC_STORMS_URL, { signal, timeoutMs: 15_000 })).data ?? {};
          const cones = new Map<string, Geo>();
          let coneOk = 0;
          await Promise.all(
            (res.activeStorms ?? []).map(async (s) => {
              const url = s.binNumber ? coneQueryUrl(s.binNumber) : null;
              if (!url) return;
              try {
                const cone = parseCone((await httpJson<{ features?: { geometry?: unknown }[] }>(url, { signal, timeoutMs: 15_000 })).data ?? {});
                if (cone) {
                  cones.set(s.binNumber!.toUpperCase(), cone);
                  coneOk++;
                }
              } catch {
                // The storm is still shown at its advisory position without a cone.
              }
            }),
          );
          providers.nhc_cones = { status: { ok: true, count: coneOk, ms: 0, age_s: 0 }, okAt: Date.now() };
          return normalizeNhc(res, cones);
        },
        (r) => r.length,
        // "No active tropical cyclones" is a truthful answer most of the year.
        { allowEmpty: true },
      ),
      runProvider(
        async () => {
          const res = await httpRequest(GVP_URL, { signal, timeoutMs: 20_000 });
          if (!res.ok) throw new HttpError(`HTTP ${res.status}`, 'http', res.url, res.status);
          return normalizeGvp(decodeXml(res.body));
        },
        (r) => r.length,
      ),
    ]);
    providers.eonet = eonet.run;
    providers.nws = nws.run;
    providers.gdacs = gdacs.run;
    providers.nhc = nhc.run;
    providers.gvp = gvp.run;
    if (!nhc.run.status.ok) delete providers.nhc_cones;
    const nhcItems = nhc.result ?? [];
    const items = [...dedupeStorms(eonet.result ?? [], nhcItems), ...(nws.result ?? []), ...(gdacs.result ?? []), ...nhcItems, ...(gvp.result ?? [])];
    // Zero events is only truthful when every provider answered (NHC's "no storms" alone is not).
    const answered = items.length > 0 || [eonet, nws, gdacs, nhc, gvp].every((p) => p.run.status.ok);
    return { data: { items, unplacedAlerts: unplaced, answered }, providers, observedAt: newestObservation(items) };
  },
});
