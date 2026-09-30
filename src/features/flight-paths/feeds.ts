/**
 * Server-side feeds for flight-paths. Owner: feature-flight-paths. Server-only.
 * List every Feed defined with defineFeed() in this area so instrumentation can start the eager
 * ones and /api/health reports them before their first request.
 */
import 'server-only';
import type { Feed } from '@/lib/feeds';

export const feeds: Feed<unknown>[] = [];
