/**
 * /api/fires body builder: FIRE_FIELDS columnar rows, served pre-serialised and brotli/gzip
 * compressed once per snapshot; SOURCE OFFLINE (503) when no FIRMS file has ever loaded.
 * Owner: layers-hazards. Server-only.
 */
import 'server-only';
import type { FeedResult } from '@/lib/feeds';
import { compressedJson, feedJson } from '@/lib/respond';
import { FIRE_FIELDS } from '@/lib/schemas';
import type { FiresData } from './firms';
import { FIRE_SAMPLING_RULE } from './firms-parse';

export function firesBody(d: FiresData) {
  return {
    fields: FIRE_FIELDS,
    rows: d.rows.map((r) => [r.id, r.lat, r.lng, r.frpMw, r.brightnessK, r.confidence, r.dayNight, r.satellite, r.seenAt]),
    totalDetections: d.totalDetections,
    sampling: FIRE_SAMPLING_RULE,
    perSatellite: d.perSatellite,
    wildfireEvents: d.wildfireEvents,
  };
}

export function firesResponse(req: Request, result: FeedResult<FiresData>): Response {
  if (result.data === null) return feedJson(req, result, firesBody);
  const data = result.data;
  // Rebuilt when the snapshot or its state changes, and at most once a minute so `age_s` stays honest.
  const version = `${result.meta.fetchedAt}|${result.meta.state}|${Math.floor(Date.now() / 60_000)}`;
  const ttl = result.meta.state === 'live' || result.meta.state === 'recent' ? result.meta.ttlSeconds : 15;
  return compressedJson(req, 'fires', version, () => ({ ...firesBody(data), meta: result.meta, providers: result.providers }), ttl);
}
