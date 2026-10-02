/**
 * GET /api/flights/stream — SSE: `snapshot` (FlightsResponse) on connect, then `update` (changed
 * rows only), `status` (retired ids + meta + providers) per feed refresh, and `heartbeat` every
 * 15 s. One server-side loop fans out to every client (≤ 4 streams per client IP).
 * Owner: layers-aviation.
 */
import { withRoute } from '@/lib/respond';
import { flightsFeed } from '@/features/aviation/feeds';
import { flightsHub, streamBufferBytes } from '@/features/aviation/server/stream';

export const dynamic = 'force-dynamic';

export const GET = withRoute('/api/flights/stream', async (req: Request) => {
  // Prime the feed so the connect snapshot carries data (or an honest SOURCE OFFLINE).
  const result = await flightsFeed.get();
  // Room for one connect snapshot (+ one delta) at the current aircraft count, never more than 4 MB.
  return flightsHub().subscribe(req, { maxBufferedBytes: streamBufferBytes(result.data?.records.length ?? 0) });
});
