/**
 * GET /api/cctv/providers — the camera provider registry (CameraProvidersResponse): operator,
 * licence, attribution, terms, key requirement, poll interval, proxy/link-out flags per source, with
 * each provider's last inventory status from the region feeds (`providers`), the frame availability
 * of every proxied provider over the last 10 minutes (`frames`: an operator can list cameras while
 * serving no images), and the OSIRIS sources deliberately not wired (`notWired`).
 * Owner: layers-surveillance.
 */
import { regionFeed } from '@/features/surveillance/server/catalog';
import { frameHealth } from '@/features/surveillance/server/frame-health';
import { NOT_WIRED_SOURCES, PROVIDERS, providerRow } from '@/features/surveillance/server/registry';
import { CCTV_REGIONS, removalContact } from '@/features/surveillance/shared';
import { json, withRoute } from '@/lib/respond';
import type { FeedMeta, Providers } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** Short edge TTL: `frames` and the inventory ages must not be pinned for long. */
const PROVIDERS_TTL_S = 60;

export const GET = withRoute('/api/cctv/providers', () => {
  const items = PROVIDERS.map((p) => providerRow(p));
  const providers: Providers = {};
  for (const r of CCTV_REGIONS) Object.assign(providers, regionFeed(r).peek().providers);
  const frames = frameHealth(items.filter((p) => p.proxy_allowed && !p.link_out_only).map((p) => p.id));
  const meta: FeedMeta = {
    feed: 'cctv-providers',
    kind: 'reference',
    state: 'reference',
    fetchedAt: null,
    observedAt: null,
    lastGoodAt: null,
    stale: false,
    ttlSeconds: 3600,
    attribution: items.map((p) => ({ text: p.attribution_string, url: p.terms_url, licence: p.licence })),
    note: 'Registry of official camera operators. `providers` reflects the last inventory refresh of each region; `frames` counts the frames this server relayed in the last 10 minutes (FRAMES UNAVAILABLE when more than 90 % of at least 3 cameras tried are failing).',
  };
  return json({ items, meta, providers, frames, removal: removalContact(process.env), notWired: NOT_WIRED_SOURCES }, { ttl: PROVIDERS_TTL_S });
});
