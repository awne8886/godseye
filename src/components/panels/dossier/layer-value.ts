/**
 * Region Dossier live-layer value: a count, or the honest reason there is none. Pure (tested).
 * Owner: panels-alerts-markets-dossier-graph.
 */
import { FRESHNESS_COLOR_TOKEN } from '@/lib/freshness';
import type { RegionDossierResponse } from '@/lib/types';

type LayerCount = RegionDossierResponse['nearby']['counts'][string];

/** One honest short value per layer: a number, or why there is none (fits one line). */
export function layerValue(c: LayerCount): { text: string; token: string } {
  if (c.count === null) {
    switch (c.reason) {
      case 'pending':
        return { text: 'Loading', token: '--text-secondary' };
      case 'unavailable':
        return { text: 'Unreadable', token: '--alert-orange' };
      case 'not-configured':
        return { text: 'No key', token: '--text-muted' };
      case 'licence':
        return { text: 'Licence off', token: '--text-muted' };
      default:
        return { text: 'Offline', token: '--alert-red' };
    }
  }
  const suffix = c.state === 'live' ? '' : c.state === 'reference' ? ' · ref' : ` · ${c.state}`;
  return { text: `${c.count}${c.reason === 'partial' ? '+' : ''}${suffix}`, token: FRESHNESS_COLOR_TOKEN[c.state] };
}

