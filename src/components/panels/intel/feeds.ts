/**
 * Server-side feeds for Live Alerts, markets, ticker and dossier. Owner:
 * panels-alerts-markets-dossier-graph. Server-only. See src/features/aviation/feeds.ts.
 */
import 'server-only';
import type { Feed } from '@/lib/feeds';

export const feeds: Feed<unknown>[] = [];
