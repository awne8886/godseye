/**
 * GET /api/satellites?category= — the OMM catalogue as SATELLITE_FIELDS columnar rows with mission
 * colours and per-category counts. Positions are NOT computed here: the client propagates the
 * elements (SGP4) in a worker. Pre-serialised + precompressed per (snapshot, category, minute).
 * Owner: layers-space.
 */
import { z } from 'zod';
import { compressedJson, feedJson, parseQuery, withRoute } from '@/lib/respond';
import { SATELLITE_FIELDS, SatCategory } from '@/lib/schemas/space';
import { satellitesFeed } from '@/features/space/feeds';
import { COL, countByCategory, MISSIONS } from '@/features/space/lib/catalog';

export const dynamic = 'force-dynamic';

const Query = z.object({ category: SatCategory.optional() });

export const GET = withRoute('/api/satellites', async (req: Request) => {
  const q = parseQuery(req, Query);
  if (!q.ok) return q.response;
  const result = await satellitesFeed.get();
  const data = result.data;
  if (!data) return feedJson(req, result, () => ({})); // 503 SOURCE OFFLINE with last-good time
  const category = q.data.category;
  const rows = category ? data.rows.filter((r) => r[COL.category] === category) : data.rows;
  const fallback = data.source === 'satnogs';
  const ttl = result.meta.state === 'live' || result.meta.state === 'recent' ? result.meta.ttlSeconds : Math.min(result.meta.ttlSeconds, 15);
  // Providers' age_s is re-derived at most once a minute (the body is compressed once per version).
  const minute = Math.floor(Date.now() / 60_000);
  const version = `${result.meta.fetchedAt}|${result.meta.state}|${minute}`;
  return compressedJson(
    req,
    `satellites:${category ?? 'all'}`,
    version,
    () => ({
      fields: SATELLITE_FIELDS,
      rows,
      missions: MISSIONS,
      categoryCounts: category ? countByCategory(rows) : data.categoryCounts,
      catalogueSource: fallback ? 'satnogs-fallback' : 'celestrak',
      ...(fallback
        ? { note: `CelesTrak unavailable: SatNOGS DB fallback (${data.rows.length.toLocaleString('en-US')} objects with published TLEs), not the full active catalogue.` }
        : {}),
      meta: result.meta,
      providers: result.providers,
    }),
    ttl,
  );
});
