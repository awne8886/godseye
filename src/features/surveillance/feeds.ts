/**
 * Server-side feeds for surveillance. Owner: layers-surveillance. Server-only.
 * One camera-inventory feed per region (`cctv:<region>`) plus the live-news channel check. None is
 * eager: a region starts polling on its first request and stops when idle.
 */
import 'server-only';
import type { Feed } from '@/lib/feeds';
import { allRegionFeeds } from './server/catalog';
import { liveNewsFeed } from './server/live-news';

export const feeds: Feed<unknown>[] = [...allRegionFeeds(), liveNewsFeed] as Feed<unknown>[];
