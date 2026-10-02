/**
 * Server-side feeds for hazards. Owner: layers-hazards. Server-only.
 * List every Feed defined with defineFeed() in this area so instrumentation can start the eager
 * ones (earthquakes, weather) and /api/health reports them before their first request. Keyed
 * lookups (air quality by bbox, gpsjam by date, Sentinel by point) are sourceCache lookups in
 * ./server and are not feeds.
 */
import 'server-only';
import type { Feed } from '@/lib/feeds';
import { firesFeed } from './server/firms';
import { radarFeed } from './server/radar';
import { earthquakeFeed } from './server/usgs';
import { weatherFeed } from './server/weather';

export const feeds: Feed<unknown>[] = [earthquakeFeed(), firesFeed, weatherFeed, radarFeed] as Feed<unknown>[];
