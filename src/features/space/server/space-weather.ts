/**
 * NOAA SWPC space-weather feed (keyless, public domain, ACAO *; probed 2026-09-30).
 * Six small providers polled every 5 min while read. A provider that fails keeps its previous
 * section (each section carries its own observedAt, so nothing claims to be fresher than it is);
 * the Kp section is never defaulted — a missing reading is "Unknown", never "Quiet".
 * Server-only. Owner: layers-space.
 */
import 'server-only';
import { httpJson } from '@/lib/http';
import { providerBucket } from '@/lib/ratelimit';
import { runProvider, type FeedContext, type FeedData, type ProviderRun } from '@/lib/feeds';
import type { SpaceWeatherResponse } from '@/lib/types';
import { kpReading, parseAlerts, parseKp, parseRtswMag, parseRtswWind, parseScales, parseXray, solarWind, type MagReading, type PlasmaReading } from '../lib/swpc';

const SWPC = 'https://services.swpc.noaa.gov';
export const SWPC_URLS = {
  kp: `${SWPC}/products/noaa-planetary-k-index.json`,
  rtswMag: `${SWPC}/json/rtsw/rtsw_mag_1m.json`,
  rtswWind: `${SWPC}/json/rtsw/rtsw_wind_1m.json`,
  xrays: `${SWPC}/json/goes/primary/xrays-6-hour.json`,
  scales: `${SWPC}/products/noaa-scales.json`,
  alerts: `${SWPC}/products/alerts.json`,
} as const;

export type SpaceWeatherData = Omit<SpaceWeatherResponse, 'meta' | 'providers'> & {
  /** Internal: last plasma/mag readings, kept separately so one failing file keeps the other. */
  plasma: PlasmaReading | null;
  mag: MagReading | null;
};

const bucket = () => providerBucket('swpc', 5, 6);
const get = (url: string, signal: AbortSignal) => httpJson<unknown>(url, { retries: 1, timeoutMs: 20_000, maxBytes: 16 * 1024 * 1024, limiter: bucket(), signal }).then((r) => r.data);

export async function runSpaceWeather(ctx: FeedContext<SpaceWeatherData>): Promise<FeedData<SpaceWeatherData>> {
  const prev = ctx.previous;
  const s = ctx.signal;
  const [kp, mag, wind, xray, scales, alerts] = await Promise.all([
    runProvider(async () => parseKp(await get(SWPC_URLS.kp, s)), (d) => d.length),
    runProvider(async () => parseRtswMag(await get(SWPC_URLS.rtswMag, s)), (d) => (d ? 1 : 0)),
    runProvider(async () => parseRtswWind(await get(SWPC_URLS.rtswWind, s)), (d) => (d ? 1 : 0)),
    runProvider(async () => parseXray(await get(SWPC_URLS.xrays, s)), (d) => (d.flux !== null ? 1 : 0)),
    runProvider(async () => parseScales(await get(SWPC_URLS.scales, s)), (d) => [d.R, d.S, d.G].filter((v) => v !== null).length),
    // "No space-weather alerts right now" is a truthful answer.
    runProvider(async () => parseAlerts(await get(SWPC_URLS.alerts, s)), (d) => d.length, { allowEmpty: true }),
  ]);
  const providers: Record<string, ProviderRun> = {
    'swpc-kp': kp.run,
    'swpc-rtsw-mag': mag.run,
    'swpc-rtsw-wind': wind.run,
    'swpc-xrays': xray.run,
    'swpc-scales': scales.run,
    'swpc-alerts': alerts.run,
  };
  if (Object.values(providers).every((p) => !p.status.ok)) throw new Error('every SWPC provider failed');

  const kpPoints = kp.run.status.ok && kp.result ? kp.result : null;
  const latest = kpPoints?.at(-1) ?? null;
  const plasma = wind.run.status.ok ? (wind.result ?? null) : (prev?.plasma ?? null);
  const magR = mag.run.status.ok ? (mag.result ?? null) : (prev?.mag ?? null);
  const data: SpaceWeatherData = {
    kp: kpPoints ? kpReading(latest?.kp ?? null, latest?.at ?? null) : (prev?.kp ?? kpReading(null, null)),
    kpHistory: kpPoints ? kpPoints.map((p) => ({ at: p.at, kp: p.kp })) : (prev?.kpHistory ?? []),
    scales: scales.run.status.ok && scales.result ? scales.result : (prev?.scales ?? { R: null, S: null, G: null }),
    xray: xray.run.status.ok && xray.result ? xray.result : (prev?.xray ?? { flux: null, class: null, observedAt: null }),
    solarWind: solarWind(plasma, magR),
    alerts: alerts.run.status.ok && alerts.result ? alerts.result : (prev?.alerts ?? []),
    plasma,
    mag: magR,
  };
  const obs = [data.xray.observedAt, data.solarWind.observedAt, data.kp.observedAt].map((t) => (t ? Date.parse(t) : 0));
  return { data, providers, observedAt: Math.max(...obs) || null };
}
