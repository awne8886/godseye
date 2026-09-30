/**
 * GET /api/news?kind=&bloc= — Live Alerts (NewsResponse): public Telegram previews + wire RSS,
 * deduped across channels, keyword-classified (method stated) and gazetteer-pinned (precision
 * stated). Sources that failed stay listed with `ok: false` (SOURCE OFFLINE), never hidden.
 * Owner: panels-alerts-markets-dossier-graph.
 */
import { z } from 'zod';
import { newsFeed } from '@/components/panels/intel/feeds';
import { feedJson, parseQuery, withRoute } from '@/lib/respond';
import { AlertKind, Bloc } from '@/lib/schemas/intel';

export const dynamic = 'force-dynamic';

const Query = z.object({ kind: AlertKind.optional(), bloc: Bloc.optional() });

export const GET = withRoute('/api/news', async (req) => {
  const q = parseQuery(req, Query);
  if (!q.ok) return q.response;
  return feedJson(req, await newsFeed.get(), (d) => ({
    items: d.items.filter((it) => (!q.data.kind || it.kind === q.data.kind) && (!q.data.bloc || it.bloc === q.data.bloc)),
    sources: d.sources,
  }));
});
