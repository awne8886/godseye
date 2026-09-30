/**
 * Supply-chain sites (REFERENCE list of major, publicly documented plants; coordinates are the host
 * city centre, not the plant gate) checked against live hazards read in-process: USGS quakes
 * (M ≥ 4.5 within 300 km, the earthquakes feed) and severe weather events (within 150 km, the weather
 * feed). The method is stated on every threat. Also: maritime chokepoint alerts for the MARKETS panel
 * from the maritime feed when that feed exists in this process.
 * Owner: panels-alerts-markets-dossier-graph. Server-only.
 */
import 'server-only';
import { getFeed, type FeedData, type ProviderRun } from '@/lib/feeds';
import { distanceKm } from '@/lib/geo';
import { earthquakeFeed } from '@/features/hazards/server/usgs';
import type { Earthquake } from '@/lib/types';

export type ScmCategory = 'Semiconductor' | 'Electronics' | 'Automotive' | 'Battery';

export interface Supplier {
  id: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
  category: ScmCategory;
}

const site = (id: string, name: string, city: string, country: string, lat: number, lng: number, category: ScmCategory): Supplier => ({ id, name, city, country, lat, lng, category });

export const SUPPLIERS: readonly Supplier[] = [
  site('tsmc-hsinchu', 'TSMC', 'Hsinchu', 'Taiwan', 24.8, 120.97, 'Semiconductor'),
  site('tsmc-tainan', 'TSMC Fab 18', 'Tainan', 'Taiwan', 22.99, 120.21, 'Semiconductor'),
  site('samsung-pyeongtaek', 'Samsung Electronics', 'Pyeongtaek', 'South Korea', 36.99, 127.11, 'Semiconductor'),
  site('skhynix-icheon', 'SK hynix', 'Icheon', 'South Korea', 37.27, 127.44, 'Semiconductor'),
  site('intel-chandler', 'Intel Ocotillo', 'Chandler', 'United States', 33.31, -111.84, 'Semiconductor'),
  site('asml-veldhoven', 'ASML', 'Veldhoven', 'Netherlands', 51.42, 5.4, 'Semiconductor'),
  site('kioxia-yokkaichi', 'Kioxia', 'Yokkaichi', 'Japan', 34.97, 136.62, 'Semiconductor'),
  site('micron-boise', 'Micron', 'Boise', 'United States', 43.62, -116.2, 'Semiconductor'),
  site('infineon-dresden', 'Infineon', 'Dresden', 'Germany', 51.05, 13.74, 'Semiconductor'),
  site('foxconn-zhengzhou', 'Foxconn', 'Zhengzhou', 'China', 34.75, 113.63, 'Electronics'),
  site('foxconn-shenzhen', 'Foxconn Longhua', 'Shenzhen', 'China', 22.54, 114.06, 'Electronics'),
  site('toyota-toyota', 'Toyota Motor', 'Toyota City', 'Japan', 35.08, 137.16, 'Automotive'),
  site('vw-wolfsburg', 'Volkswagen', 'Wolfsburg', 'Germany', 52.42, 10.79, 'Automotive'),
  site('hyundai-ulsan', 'Hyundai Motor', 'Ulsan', 'South Korea', 35.54, 129.31, 'Automotive'),
  site('catl-ningde', 'CATL', 'Ningde', 'China', 26.66, 119.55, 'Battery'),
  site('tesla-reno', 'Tesla / Panasonic Gigafactory', 'Reno (Storey County)', 'United States', 39.53, -119.81, 'Battery'),
  site('lges-ochang', 'LG Energy Solution', 'Cheongju (Ochang)', 'South Korea', 36.64, 127.49, 'Battery'),
];

export interface ScmThreat {
  label: string;
  distanceKm: number;
  method: string;
  observedAt: string | null;
}

export interface ScmItem extends Supplier {
  riskLevel: 'NORMAL' | 'HIGH' | 'CRITICAL';
  threats: ScmThreat[];
}

const QUAKE_METHOD = 'USGS M≥4.5 within 300 km (last 2.5 days)';
const WEATHER_METHOD = 'Severe-weather event within 150 km (weather feed)';

export function assess(quakes: readonly Pick<Earthquake, 'magnitude' | 'place' | 'lat' | 'lng' | 'observedAt'>[], weather: readonly { title: string; lat: number; lng: number; severity?: string; observedAt: string | null }[]): ScmItem[] {
  return SUPPLIERS.map((s) => {
    const threats: ScmThreat[] = [];
    let level: ScmItem['riskLevel'] = 'NORMAL';
    for (const q of quakes) {
      if (q.magnitude < 4.5) continue;
      const d = distanceKm([s.lng, s.lat], [q.lng, q.lat]);
      if (d > 300) continue;
      threats.push({ label: `M${q.magnitude.toFixed(1)} earthquake${q.place ? ` — ${q.place}` : ''}`, distanceKm: Math.round(d), method: QUAKE_METHOD, observedAt: q.observedAt });
      if (q.magnitude >= 6 && d <= 150) level = 'CRITICAL';
      else if (level === 'NORMAL') level = 'HIGH';
    }
    for (const w of weather) {
      if (w.severity && w.severity !== 'high') continue;
      const d = distanceKm([s.lng, s.lat], [w.lng, w.lat]);
      if (d > 150) continue;
      threats.push({ label: w.title, distanceKm: Math.round(d), method: WEATHER_METHOD, observedAt: w.observedAt });
      if (level === 'NORMAL') level = 'HIGH';
    }
    threats.sort((a, b) => a.distanceKm - b.distanceKm);
    return { ...s, riskLevel: level, threats };
  });
}

/** Provider run from another feed's result (ok when it has data; age from its fetchedAt). */
export function runFromFeed(meta: { fetchedAt: string | null; state: string } | null, count: number, hasData: boolean): ProviderRun {
  const at = meta?.fetchedAt ? Date.parse(meta.fetchedAt) : null;
  return {
    status: { ok: hasData, count, ms: 0, age_s: null, ...(hasData ? {} : { error: meta ? meta.state : 'not-available' }) },
    okAt: hasData ? at : null,
  };
}

export interface ScmData {
  items: ScmItem[];
  /** False when the quake feed had no data: every site would read NORMAL without having been checked. */
  hazardsChecked: boolean;
}

export async function runScm(): Promise<FeedData<ScmData>> {
  const q = await earthquakeFeed().get();
  const quakes = q.data?.items ?? [];
  const wf = getFeed('weather');
  const w = wf ? await wf.get().catch(() => null) : null;
  const weather = ((w?.data as { items?: { title: string; lat: number; lng: number; severity?: string; observedAt: string | null }[] } | null)?.items ?? []).filter((x) => typeof x.lat === 'number');
  const providers: Record<string, ProviderRun> = {
    usgs: runFromFeed(q.meta, quakes.length, q.data !== null),
    weather: runFromFeed(w?.meta ?? null, weather.length, !!w?.data),
  };
  const items = assess(quakes, weather);
  return { data: { items, hazardsChecked: q.data !== null }, providers, observedAt: q.meta.observedAt ? Date.parse(q.meta.observedAt) : null };
}

/** Chokepoint alerts from the maritime feed (when registered). Shape-tolerant: `{chokepoints:[{name, risk, message}]}`. */
export async function chokepointAlerts(): Promise<{ alerts: { chokepoint: string; risk: string; message: string }[]; run: ProviderRun }> {
  const f = getFeed('maritime');
  if (!f) return { alerts: [], run: runFromFeed(null, 0, false) };
  const r = await f.get().catch(() => null);
  const cps = ((r?.data as { chokepoints?: { name?: string; risk?: string; message?: string; status?: string }[] } | null)?.chokepoints ?? []).filter((c) => c.name);
  const alerts = cps.filter((c) => c.risk && c.risk.toUpperCase() !== 'NORMAL').map((c) => ({ chokepoint: c.name!, risk: c.risk!, message: c.message ?? c.status ?? '' }));
  return { alerts, run: runFromFeed(r?.meta ?? null, cps.length, !!r?.data) };
}
