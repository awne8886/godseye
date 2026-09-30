/**
 * GET /api/fires — NASA FIRMS global 24 h fire pixels as FIRE_FIELDS columnar rows, sampled by fire
 * radiative power (top 30 000, never by stride), with `totalDetections` and the sampling rule,
 * plus EONET open wildfire events (FiresResponse). Owner: layers-hazards.
 */
import { firesResponse } from '@/features/hazards/server/fires-response';
import { firesFeed } from '@/features/hazards/server/firms';
import { withRoute } from '@/lib/respond';

export const dynamic = 'force-dynamic';

export const GET = withRoute('/api/fires', async (req) => firesResponse(req, await firesFeed.get()));
