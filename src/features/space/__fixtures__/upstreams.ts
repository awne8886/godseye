/**
 * Test-only upstream router for `vi.mock('@/lib/http')`: maps request URLs to recorded fixtures
 * (captured 2026-09-30, see ./index.ts) or to errors. Never imported by shipped code.
 */
import { HttpError } from '@/lib/http';
import { fx } from './index';

export type Answer = unknown | Error | (() => unknown);

export function upstreamRouter(routes: Record<string, Answer>) {
  const calls: string[] = [];
  const impl = async (url: string | URL) => {
    const u = String(url);
    calls.push(u);
    const key = Object.keys(routes).find((k) => u.includes(k));
    if (key === undefined) throw new HttpError('HTTP 404', 'http', u, 404);
    let v = routes[key];
    if (typeof v === 'function') v = (v as () => unknown)();
    if (v instanceof Error) throw v;
    return { status: 200, ok: true, notModified: false, headers: {}, body: Buffer.from(''), url: u, etag: null, lastModified: null, ms: 1, attempts: 1, data: v };
  };
  return { impl, calls };
}

/** Every CelesTrak group used by the feed, answered from the fixtures (members derived from names). */
export function celestrakRoutes(): Record<string, Answer> {
  const ids = (re: RegExp) => fx.active.filter((o) => re.test(String(o.OBJECT_NAME)));
  return {
    'GROUP=active&': fx.active,
    'GROUP=stations&': fx.stations,
    'GROUP=science&': [],
    'GROUP=geodetic&': [],
    'GROUP=gps-ops&': ids(/^NAVSTAR/),
    'GROUP=glonass-operational&': ids(/GLONASS/),
    'GROUP=galileo&': ids(/GALILEO/),
    'GROUP=beidou&': ids(/^BEIDOU/),
    'GROUP=military&': [],
    'GROUP=radar&': [],
    'GROUP=weather&': [],
    'GROUP=resource&': [],
    'GROUP=other-comm&': [],
  };
}

export const swpcRoutes = (): Record<string, Answer> => ({
  'noaa-planetary-k-index.json': fx.kp,
  'rtsw_mag_1m.json': fx.mag,
  'rtsw_wind_1m.json': fx.wind,
  'xrays-6-hour.json': fx.xrays,
  'noaa-scales.json': fx.scales,
  'products/alerts.json': fx.alerts,
});

export const netError = (u = 'https://celestrak.org/') => new HttpError('socket hang up (ECONNRESET)', 'network', u);
