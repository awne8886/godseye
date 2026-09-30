/**
 * Frontlines: DeepStateMap (Ukraine) latest snapshot. Owner: layers-threats-network. Server-only.
 *
 * Probed 2026-09-30: HEAD `api/history/last` 200 in 0.58 s (ACAO *, ~627 KB); `api/history/public`
 * lists snapshots with `createdAt`/`updatedAt` (ISO) and `id` (unix seconds).
 * Licence: non-commercial use with attribution; commercial use needs DeepState's approval. The
 * feed only runs with the `deepstate` capability (NONCOMMERCIAL=true and not a commercial
 * deployment); otherwise the provider is reported as skipped: licence.
 */
import 'server-only';
import { hasCapability } from '@/lib/capabilities';
import { defineFeed, runProvider, skippedProvider } from '@/lib/feeds';
import { httpJson } from '@/lib/http';

export const DEEPSTATE_URL = 'https://deepstatemap.live/api/history/last';

interface DeepStateSnapshot {
  id?: number;
  createdAt?: string;
  updatedAt?: string;
  map?: GeoJSON.FeatureCollection;
}

/** Keep polygon/line geometry and a plain-text name only (upstream descriptions carry HTML). */
export function normalizeDeepState(s: DeepStateSnapshot): { geojson: GeoJSON.FeatureCollection; asOf: string | null } {
  const features: GeoJSON.Feature[] = [];
  let i = 0;
  for (const f of s.map?.features ?? []) {
    const t = f.geometry?.type;
    if (t !== 'Polygon' && t !== 'MultiPolygon' && t !== 'LineString' && t !== 'MultiLineString') continue;
    const name = typeof f.properties?.name === 'string' ? f.properties.name.replace(/<[^>]*>/g, '').slice(0, 160) : null;
    features.push({ type: 'Feature', geometry: f.geometry, properties: { id: `ds-${i++}`, name } });
  }
  const iso = (v: unknown) => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : null);
  const asOf = iso(s.updatedAt) ?? iso(s.createdAt) ?? (typeof s.id === 'number' && s.id > 1e9 && s.id < 1e10 ? new Date(s.id * 1000).toISOString() : null);
  return { geojson: { type: 'FeatureCollection', features }, asOf };
}

export const frontlinesFeed = defineFeed<{ geojson: GeoJSON.FeatureCollection; asOf: string | null }>({
  key: 'frontlines',
  ttlMs: 60 * 60_000,
  pollMs: 30 * 60_000,
  kind: 'live',
  attribution: [{ text: 'Frontlines: DeepStateMap.Live', url: 'https://deepstatemap.live/', licence: 'Non-commercial use with attribution (deepstatemap.live/license-en.html)' }],
  count: (d) => d.geojson.features.length,
  maxObservationAgeMs: 3 * 24 * 60 * 60_000,
  deadlineMs: 45_000,
  run: async ({ signal }) => {
    if (!hasCapability('deepstate')) return { data: { geojson: { type: 'FeatureCollection', features: [] }, asOf: null }, providers: { deepstate: skippedProvider('licence') } };
    const { result, run } = await runProvider(
      async () => normalizeDeepState((await httpJson<DeepStateSnapshot>(DEEPSTATE_URL, { signal, timeoutMs: 30_000 })).data ?? {}),
      (r) => r.geojson.features.length,
    );
    const data = result ?? { geojson: { type: 'FeatureCollection' as const, features: [] }, asOf: null };
    return { data, providers: { deepstate: run }, observedAt: data.asOf ? Date.parse(data.asOf) : null };
  },
});
