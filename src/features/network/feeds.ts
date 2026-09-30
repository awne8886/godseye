/**
 * Server-side feeds for network. Owner: layers-threats-network. Server-only.
 * Every Feed defined with defineFeed() in this area, so instrumentation can start the eager ones
 * and /api/health reports them before their first request.
 */
import 'server-only';
import type { Feed } from '@/lib/feeds';
import { c2Feed, threatFoxFeed } from './server/abusech';
import { cablesFeed } from './server/cables';
import { kevFeed } from './server/kev';
import { attackOriginsFeed, outagesFeed } from './server/outages';
import { malwareFeed } from './server/urlhaus';

export const feeds: Feed<unknown>[] = [malwareFeed, c2Feed, threatFoxFeed, kevFeed, outagesFeed, attackOriginsFeed, cablesFeed] as Feed<unknown>[];
