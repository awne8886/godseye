/**
 * RainViewer past-radar frame metadata. Tiles load in the browser from tilecache.rainviewer.com
 * (in TILE_HOSTS); only the frame list comes through /api. §6.2: RainViewer has no nowcast or
 * satellite-IR frames any more (both arrays are empty) and radar tiles stop at zoom 7; the free
 * tier allows 100 requests/IP/min. Owner: layers-hazards. Server-only.
 *
 * Probed 2026-09-30: `api.rainviewer.com/public/weather-maps.json` 200 in 0.77 s, CORS `*`,
 * 13 past frames at 10-minute spacing, `host` https://tilecache.rainviewer.com.
 */
import 'server-only';
import { defineFeed, runProvider } from '@/lib/feeds';
import { httpJson } from '@/lib/http';

export const RAINVIEWER_URL = 'https://api.rainviewer.com/public/weather-maps.json';
export const RADAR_MAX_ZOOM = 7;

export interface RadarData {
  host: string;
  frames: { time: string; path: string }[];
}

interface WeatherMaps {
  host?: string;
  radar?: { past?: { time?: number; path?: string }[] };
}

export function normalizeRainViewer(body: WeatherMaps): RadarData {
  const host = typeof body.host === 'string' && /^https:\/\/[a-z0-9.-]+$/i.test(body.host) ? body.host : 'https://tilecache.rainviewer.com';
  const frames = (body.radar?.past ?? [])
    .filter((f): f is { time: number; path: string } => typeof f.time === 'number' && typeof f.path === 'string' && /^\/v2\/radar\/[A-Za-z0-9_-]+$/.test(f.path))
    .map((f) => ({ time: new Date(f.time * 1000).toISOString(), path: f.path }))
    .sort((a, b) => a.time.localeCompare(b.time));
  return { host, frames };
}

export const radarFeed = defineFeed<RadarData>({
  key: 'weather-radar',
  ttlMs: 5 * 60_000,
  kind: 'live',
  attribution: [{ text: 'Weather radar: RainViewer', url: 'https://www.rainviewer.com/api.html', licence: 'RainViewer API terms (free, attribution)' }],
  note: 'Past radar frames only (no nowcast); tiles up to zoom 7',
  count: (d) => d.frames.length,
  run: async ({ signal }) => {
    const { result, run } = await runProvider(async () => normalizeRainViewer((await httpJson<WeatherMaps>(RAINVIEWER_URL, { signal, timeoutMs: 15_000 })).data ?? {}), (r) => r.frames.length);
    const newest = result?.frames.at(-1)?.time;
    return { data: result ?? { host: 'https://tilecache.rainviewer.com', frames: [] }, providers: { rainviewer: run }, observedAt: newest ? Date.parse(newest) : null };
  },
});
