/**
 * Server-side feeds for surveillance. Owner: layers-surveillance. Server-only.
 * List every Feed defined with defineFeed() in this area so instrumentation can start the eager
 * ones and /api/health reports them before their first request.
 */
import 'server-only';
import type { Feed } from '@/lib/feeds';

export const feeds: Feed<unknown>[] = [];
