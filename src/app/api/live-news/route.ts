/**
 * GET /api/live-news — curated official broadcaster channels (LiveNewsResponse) with youtube-nocookie
 * embed URLs where embedding is allowed and a server-side hourly live check (`live`: true/false/null).
 * Owner: layers-surveillance.
 */
import { liveNewsFeed } from '@/features/surveillance/server/live-news';
import { feedJson, withRoute } from '@/lib/respond';

export const dynamic = 'force-dynamic';

export const GET = withRoute('/api/live-news', async (req) => feedJson(req, await liveNewsFeed.get(), (d) => ({ items: d })));
