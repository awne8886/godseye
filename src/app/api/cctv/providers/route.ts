/**
 * GET /api/cctv/providers — the camera provider registry (CameraProvidersResponse): operator,
 * licence, attribution, terms, key requirement, poll interval, proxy/link-out flags per source, with
 * each provider's last status from the region feeds. Owner: layers-surveillance.
 */
import { regionFeed } from '@/features/surveillance/server/catalog';
import { PROVIDERS, providerRow } from '@/features/surveillance/server/registry';
import { CCTV_REGIONS, removalContact } from '@/features/surveillance/shared';
import { json, withRoute } from '@/lib/respond';
import type { FeedMeta, Providers } from '@/lib/types';

export const dynamic = 'force-dynamic';

export const GET = withRoute('/api/cctv/providers', () => {
  const items = PROVIDERS.map((p) => providerRow(p));
  const providers: Providers = {};
  for (const r of CCTV_REGIONS) Object.assign(providers, regionFeed(r).peek().providers);
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
    note: 'Registry of official camera operators. Provider status reflects the last inventory refresh of each region.',
  };
  return json({ items, meta, providers, removal: removalContact(process.env) }, { ttl: 300 });
});
