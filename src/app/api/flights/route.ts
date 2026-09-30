/**
 * GET /api/flights — live aircraft as compact columnar rows (FlightsResponse), classified into
 * OSIRIS's four buckets. `?bucket=military,jet` and `?bbox=w,s,e,n` filter. Served from the
 * `flights` feed, pre-serialised and precompressed per snapshot (< 4 MB for 24k aircraft).
 * 503 SOURCE OFFLINE (with last-good time) when no provider has produced data.
 * Owner: layers-aviation.
 */
import { z } from 'zod';
import { compressedJson, feedJson, parseQuery, withRoute } from '@/lib/respond';
import { parseBBox } from '@/lib/geo';
import { AircraftBucket } from '@/lib/schemas/aviation';
import { flightsFeed } from '@/features/aviation/feeds';
import { flightsBody } from '@/features/aviation/server/view';

export const dynamic = 'force-dynamic';

const Query = z.object({
  bucket: z
    .string()
    .max(64)
    .transform((v) => v.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))
    .pipe(z.array(AircraftBucket).min(1))
    .optional(),
  bbox: z
    .string()
    .max(96)
    .transform((v, ctx) => {
      const b = parseBBox(v);
      if (!b) ctx.addIssue({ code: 'custom', message: 'bbox must be west,south,east,north in degrees' });
      return b ?? z.NEVER;
    })
    .optional(),
});

export const GET = withRoute('/api/flights', async (req: Request) => {
  const q = parseQuery(req, Query);
  if (!q.ok) return q.response;
  const result = await flightsFeed.get();
  if (result.data === null) return feedJson(req, result, () => ({}));
  const data = result.data;
  const buckets = q.data.bucket ? [...new Set(q.data.bucket)].sort() : null;
  const bbox = q.data.bbox ?? null;
  const variant = `${buckets?.join(',') ?? '*'}|${bbox?.join(',') ?? '*'}`;
  const version = `${result.meta.fetchedAt}|${result.meta.state}`;
  return compressedJson(
    req,
    `flights:${variant}`,
    version,
    () => ({ ...flightsBody(data, { buckets: buckets ? new Set(buckets) : null, bbox }), meta: result.meta, providers: result.providers }),
    result.meta.state === 'live' || result.meta.state === 'recent' ? result.meta.ttlSeconds : Math.min(result.meta.ttlSeconds, 15),
  );
});
