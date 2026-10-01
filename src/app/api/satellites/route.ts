/**
 * GET /api/satellites?category=&id= — the OMM catalogue as SATELLITE_FIELDS columnar rows with mission
 * colours and per-category counts. Positions are NOT computed here: the client propagates the
 * elements (SGP4) in a worker. `id` narrows to one NORAD id (the SPACE panel's ISS look-up), so
 * the main thread never needs the whole catalogue.
 *
 * Caching (perf round 5 m-i): the weak ETag depends on CONTENT only — the snapshot, its state, the
 * provider outcomes and the next CelesTrak retry — never on the clock, so a revalidation with an
 * unchanged catalogue is a 304 with no body and no re-serialisation. A 200 body is pre-serialised
 * and precompressed at most once a minute, which is how often providers' relative `age_s` is
 * re-derived; bodies that differ only in `age_s` are semantically equivalent (weak validator).
 * Freshness stays honest through `meta` (absolute fetchedAt / observedAt / lastGoodAt, and a state
 * change changes the ETag). Owner: layers-space.
 */
import { z } from 'zod';
import { cacheControl, cdnCacheControl, compressedJson, feedJson, parseQuery, weakEtag, withRoute } from '@/lib/respond';
import { SATELLITE_FIELDS, SatCategory } from '@/lib/schemas/space';
import { noteSatellitesRead, satellitesFeed } from '@/features/space/feeds';
import { COL, countByCategory, MISSIONS } from '@/features/space/lib/catalog';
import { nextCelestrakAttemptAt, recoveryProviders } from '@/features/space/server/satellites';
import { contentVersion, revalidates } from '@/features/space/server/etag';

/** While the SatNOGS fallback is served, caches and clients ask again this soon (CelesTrak may be back). */
const FALLBACK_TTL_S = 300;

export const dynamic = 'force-dynamic';

const Query = z.object({ category: SatCategory.optional(), id: z.coerce.number().int().positive().max(999_999).optional() });

export const GET = withRoute('/api/satellites', async (req: Request) => {
  const q = parseQuery(req, Query);
  if (!q.ok) return q.response;
  const result = await satellitesFeed.get();
  noteSatellitesRead();
  const data = result.data;
  if (!data) return feedJson(req, result, () => ({})); // 503 SOURCE OFFLINE with last-good time
  const { category, id } = q.data;
  const narrowed = !!category || id !== undefined;
  const rows = narrowed ? data.rows.filter((r) => (!category || r[COL.category] === category) && (id === undefined || r[COL.noradId] === id)) : data.rows;
  const fallback = data.source === 'satnogs';
  const healthy = result.meta.state === 'live' || result.meta.state === 'recent';
  const ttl = !healthy ? Math.min(result.meta.ttlSeconds, 15) : fallback ? Math.min(result.meta.ttlSeconds, FALLBACK_TTL_S) : result.meta.ttlSeconds;
  const retryAt = nextCelestrakAttemptAt(data);
  const providers = recoveryProviders(data, result.providers);
  const key = `satellites:${category ?? 'all'}:${id ?? 'all'}`;
  const content = contentVersion(result.meta, providers, retryAt);
  const etag = weakEtag(key, content);
  const headers = { 'Cache-Control': cacheControl(ttl), ...cdnCacheControl(ttl), ETag: etag, Vary: 'Accept-Encoding' };
  // Unchanged content: 304 before any serialisation (the 2.6 MB body is not rebuilt or re-sent).
  if (revalidates(req, etag)) return new Response(null, { status: 304, headers });
  // Providers' age_s is re-derived at most once a minute (the body is compressed once per version).
  const minute = Math.floor(Date.now() / 60_000);
  const epochUnit = typeof data.rows[0]?.[COL.epoch] === 'number' ? ({ epochUnit: 'ms' } as const) : {};
  const res = compressedJson(
    req,
    key,
    `${content}|${minute}`,
    () => ({
      fields: SATELLITE_FIELDS,
      rows,
      missions: MISSIONS,
      categoryCounts: narrowed ? countByCategory(rows) : data.categoryCounts,
      catalogueSource: fallback ? 'satnogs-fallback' : 'celestrak',
      ...(fallback
        ? {
            note:
              `CelesTrak unavailable: SatNOGS DB fallback (${data.rows.length.toLocaleString('en-US')} objects with published TLEs), not the full active catalogue.` +
              (retryAt !== null ? ` Next CelesTrak attempt after ${new Date(retryAt).toISOString().slice(11, 16)} UTC.` : ''),
          }
        : {}),
      ...epochUnit,
      meta: result.meta,
      providers,
    }),
    ttl,
  );
  // The validator clients keep is the content ETag, not the per-minute serialisation's.
  if (res.status === 200 || res.status === 304) res.headers.set('ETag', etag);
  return res;
});
