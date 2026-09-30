/**
 * GET /api/region-dossier?lat=50.45&lng=30.52 — Region Dossier (RegionDossierResponse): place,
 * Wikidata country facts, Wikipedia summary, Open-Meteo weather (capability `openmeteo`) and live
 * layers within 150 km read in-process, each with its own {count, state} (an offline layer is
 * reported as offline with count null, never as 0). Owner: panels-alerts-markets-dossier-graph.
 */
import { z } from 'zod';
import { runDossierStatic, type DossierStatic } from '@/components/panels/intel/server/dossier';
import { lookup } from '@/components/panels/intel/server/lookup';
import { nearbyAll } from '@/components/panels/intel/server/nearby';
import { OSM_ATTRIBUTION } from '@/lib/geocode';
import { apiError, json, parseQuery, withRoute } from '@/lib/respond';
import type { RegionDossierResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';

const Query = z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) });

const RADIUS_KM = 150;

export const GET = withRoute('/api/region-dossier', async (req) => {
  const q = parseQuery(req, Query);
  if (!q.ok) return q.response;
  // Rounded to ~1 km so nearby clicks share one cached upstream lookup.
  const lat = Math.round(q.data.lat * 100) / 100;
  const lng = Math.round(q.data.lng * 100) / 100;
  const [stat, near] = await Promise.all([
    lookup<DossierStatic>(`dossier:${lat},${lng}`, {
      feed: 'region-dossier',
      ttlMs: 30 * 60_000,
      attribution: [{ text: OSM_ATTRIBUTION }, { text: 'Wikidata (CC0) and Wikipedia (CC BY-SA 4.0)' }, { text: 'Weather: Open-Meteo (CC BY 4.0)' }],
      isEmpty: (d) => !d.location && !d.country && !d.brief && !d.weather,
      deadlineMs: 30_000,
      run: (signal) => runDossierStatic(lat, lng, signal),
    }),
    nearbyAll(lat, lng, RADIUS_KM),
  ]);
  const counts: RegionDossierResponse['nearby']['counts'] = {};
  const highlights: RegionDossierResponse['nearby']['highlights'] = [];
  for (const [layer, n] of Object.entries(near)) {
    counts[layer] = { count: n.count, state: n.state };
    for (const p of n.points.slice(0, 3)) highlights.push({ layer, id: p.id, title: p.title.slice(0, 140), distanceKm: Math.round(p.distanceKm * 10) / 10, observedAt: p.observedAt });
  }
  highlights.sort((a, b) => a.distanceKm - b.distanceKm);
  if (stat.data === null && Object.values(counts).every((c) => c.count === null)) {
    return apiError(503, 'source_offline', 'No dossier upstream answered and no live layer has data.', { retryAfter: 30, headers: { 'Retry-After': '30' } });
  }
  const providers = { ...stat.providers };
  for (const [layer, c] of Object.entries(counts)) providers[`layer:${layer}`] = { ok: c.count !== null, count: c.count ?? 0, ms: 0, age_s: null, ...(c.count === null ? { error: c.state } : {}) };
  const body: RegionDossierResponse = {
    lat,
    lng,
    location: stat.data?.location ?? null,
    country: stat.data?.country ?? null,
    brief: stat.data?.brief ?? null,
    nearby: { radiusKm: RADIUS_KM, counts, highlights: highlights.slice(0, 12) },
    weather: stat.data?.weather ?? null,
    providers,
    timestamp: new Date().toISOString(),
  };
  return json(body, { ttl: 60 });
});
