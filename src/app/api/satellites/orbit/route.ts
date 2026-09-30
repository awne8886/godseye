/**
 * GET /api/satellites/orbit?id=<NORAD>&t=<ms> — one satellite's orbit track, ±½ period around `t`
 * (the epoch the client propagated its marker for), split at the antimeridian, ≤ 8 segments of
 * ≤ 2 000 points. Propagated server-side from the SAME cached element set the catalogue serves,
 * so the track passes through the marker. `norad` is accepted as an alias of `id`.
 * Owner: layers-space.
 */
import { z } from 'zod';
import { apiError, json, parseQuery, withRoute } from '@/lib/respond';
import { satellitesFeed } from '@/features/space/feeds';
import { lookupSatellite } from '@/features/space/server/lookup';
import { anchorTime, orbitClass, orbitTrack, periodMinutes, splitTrackAtAntimeridian } from '@/features/space/lib/orbit';
import type { OrbitResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';

const NoradId = z.coerce.number().int().positive().max(999_999);
const Query = z
  .object({ id: NoradId.optional(), norad: NoradId.optional(), t: z.coerce.number().finite().positive().optional() })
  .refine((q) => q.id !== undefined || q.norad !== undefined, { message: 'id (NORAD catalogue number) is required', path: ['id'] });

export const GET = withRoute('/api/satellites/orbit', async (req: Request) => {
  const q = parseQuery(req, Query);
  if (!q.ok) return q.response;
  const noradId = (q.data.id ?? q.data.norad)!;
  const feed = await satellitesFeed.get();
  if (!feed.data) {
    return json({ error: 'source_offline', detail: 'The satellite catalogue has not loaded yet.', providers: feed.providers }, { status: 503, headers: { 'Retry-After': '30' } });
  }
  const hit = lookupSatellite(feed.data, noradId);
  if (!hit) return apiError(404, 'not_found', `NORAD ${noradId} is not in the current catalogue.`);
  const period = periodMinutes(hit.record.meanMotion);
  if (!hit.satrec || !period) return apiError(422, 'not_propagatable', `NORAD ${noradId}'s element set cannot be propagated (decayed or invalid).`);
  const anchor = anchorTime(q.data.t);
  const segments = splitTrackAtAntimeridian(orbitTrack(hit.satrec, hit.record.meanMotion, anchor, 180));
  if (segments.length === 0) return apiError(422, 'not_propagatable', `NORAD ${noradId} could not be propagated around ${anchor.toISOString()}.`);
  const body: OrbitResponse = {
    noradId,
    name: hit.record.name,
    periodMinutes: Math.round(period * 100) / 100,
    orbitClass: orbitClass(hit.record.meanMotion, hit.record.eccentricity),
    anchoredAt: anchor.toISOString(),
    segments,
    timestamp: new Date().toISOString(),
    elementsEpoch: hit.record.epoch,
    source: feed.data.source,
    providers: feed.providers,
  };
  // The shape only changes when a new element set lands; an explicit `t` makes the URL unique.
  return json(body, { ttl: 600 });
});
