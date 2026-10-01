/**
 * Supply-chain summary line for the MARKETS panel (§0: "no hazard in range" only from a fresh
 * hazard check). When the USGS input is not ok or the scm feed is stale/offline, the line names the
 * outage and the last-good check time instead of a verdict.
 * Owner: panels-alerts-markets-dossier-graph. Pure (tested).
 */
import type { ScmSuppliersResponse } from '@/lib/types';
import { utcLabel } from './markets-chip';

type ScmInput = Pick<ScmSuppliersResponse, 'meta' | 'providers' | 'items'> & Partial<Pick<ScmSuppliersResponse, 'hazardsAsOf'>>;

export function scmStatusLine(d: ScmInput, now = Date.now()): { degraded: boolean; text: string } {
  const usgs = d.providers.usgs;
  const state = d.meta.state;
  if (state === 'stale' || state === 'offline' || (usgs && !usgs.ok)) {
    const word = state === 'offline' || usgs?.error === 'offline' ? 'offline' : 'stale';
    const at = d.hazardsAsOf ?? d.meta.lastGoodAt;
    return { degraded: true, text: `Hazard source ${word} — last good ${at ? utcLabel(at, now) : 'unknown'}; sites not re-checked since` };
  }
  const clear = d.items.filter((s) => s.riskLevel === 'NORMAL').length;
  const weatherChecked = d.providers.weather?.ok === true;
  return {
    degraded: false,
    text: `${clear} of ${d.items.length} sites with no hazard in range (${weatherChecked ? 'USGS quakes and severe weather' : 'USGS quakes only; weather not checked'})`,
  };
}
