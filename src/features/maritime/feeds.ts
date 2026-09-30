/**
 * Server-side feeds for maritime. Owner: layers-threats-network. Server-only.
 * Every Feed defined with defineFeed() in this area, so instrumentation can start the eager ones
 * and /api/health reports them before their first request.
 */
import 'server-only';
import type { Feed } from '@/lib/feeds';
import { maritimeFeed } from './server/maritime';

export const feeds: Feed<unknown>[] = [maritimeFeed] as Feed<unknown>[];
