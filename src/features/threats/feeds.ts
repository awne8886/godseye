/**
 * Server-side feeds for threats. Owner: layers-threats-network. Server-only.
 * Every Feed defined with defineFeed() in this area, so instrumentation can start the eager ones
 * and /api/health reports them before their first request.
 */
import 'server-only';
import type { Feed } from '@/lib/feeds';
import { conflictsFeed } from './server/conflicts';
import { countryRiskFeed } from './server/country-risk';
import { frontlinesFeed } from './server/frontlines';
import { gdacsFeed } from './server/gdacs';
import { gdeltFeed } from './server/gdelt';
import { infrastructureFeed, wikidataFeed } from './server/nuclear';

export const feeds: Feed<unknown>[] = [gdacsFeed, gdeltFeed, conflictsFeed, frontlinesFeed, countryRiskFeed, wikidataFeed, infrastructureFeed] as Feed<unknown>[];
