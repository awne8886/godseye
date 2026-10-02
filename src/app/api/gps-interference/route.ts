/**
 * GET /api/gps-interference?date=YYYY-MM-DD — gpsjam daily H3 r4 cells with bad > 0 plus, for the
 * latest day, live NACp bins from the in-process flights feed (GpsInterferenceResponse).
 * Owner: layers-hazards.
 */
import { z } from 'zod';
import { MAX_JAM_CELLS, gpsInterference, liveNacpCells } from '@/features/hazards/server/gpsjam';
import { feedJson, parseQuery, withRoute } from '@/lib/respond';

export const dynamic = 'force-dynamic';

const Query = z.object({
  date: z.iso
    .date()
    .refine((d) => d >= '2022-02-14' && Date.parse(`${d}T00:00:00Z`) <= Date.now(), 'date must be between 2022-02-14 (first gpsjam day) and today')
    .optional(),
});

export const GET = withRoute('/api/gps-interference', async (req) => {
  const q = parseQuery(req, Query);
  if (!q.ok) return q.response;
  const result = await gpsInterference(q.data.date ?? null);
  // Live bins only accompany the latest day (a historical date is a historical view).
  const live = q.data.date ? null : liveNacpCells();
  if (live && result.data) {
    result.providers.live_nacp = { ...live.run.status, age_s: live.run.okAt ? Math.max(0, Math.round((Date.now() - live.run.okAt) / 1000)) : null };
  }
  // The live bins change with every flights snapshot: keep them out of the cached ETag variant.
  const variant = `${new URL(req.url).search}|${live?.run.okAt ?? ''}`;
  return feedJson(
    req,
    result,
    (d) => {
      const items = live ? [...d.items, ...live.cells.slice(0, Math.max(0, MAX_JAM_CELLS - d.items.length))] : d.items;
      return { items, totalCells: d.totalCells, suspect: d.suspect };
    },
    variant,
  );
});
