/**
 * CAMEO labels and colour tokens for GDELT events (CAMEO 1.1b3 root codes; QuadClass per the
 * GDELT 2.0 codebook). Owner: layers-threats-network. Isomorphic.
 */
import type { MapToken } from '@/lib/tokens';

export const CAMEO_ROOT: Record<string, string> = {
  '01': 'Make public statement',
  '02': 'Appeal',
  '03': 'Express intent to cooperate',
  '04': 'Consult',
  '05': 'Engage in diplomatic cooperation',
  '06': 'Engage in material cooperation',
  '07': 'Provide aid',
  '08': 'Yield',
  '09': 'Investigate',
  '10': 'Demand',
  '11': 'Disapprove',
  '12': 'Reject',
  '13': 'Threaten',
  '14': 'Protest',
  '15': 'Exhibit force posture',
  '16': 'Reduce relations',
  '17': 'Coerce',
  '18': 'Assault',
  '19': 'Fight',
  '20': 'Use unconventional mass violence',
};

export const QUAD_LABEL: Record<1 | 2 | 3 | 4, string> = {
  1: 'Verbal cooperation',
  2: 'Material cooperation',
  3: 'Verbal conflict',
  4: 'Material conflict',
};

export const QUAD_TOKEN: Record<1 | 2 | 3 | 4, MapToken> = {
  1: '--map-gdelt-1',
  2: '--map-gdelt-2',
  3: '--map-gdelt-3',
  4: '--map-gdelt-4',
};

/** ActionGeo_Type → how precise the point is. */
export const GEO_PRECISION_LABEL: Record<number, string> = {
  0: 'unknown',
  1: 'country centroid',
  2: 'US state centroid',
  3: 'US city',
  4: 'world city',
  5: 'world state / province centroid',
};

export function precisionClass(geoType: number): 'settlement' | 'region' | 'country' {
  if (geoType === 3 || geoType === 4) return 'settlement';
  if (geoType === 2 || geoType === 5) return 'region';
  return 'country';
}

export function gdeltTitle(e: { actor1: string | null; actor2: string | null; rootCode: string }): string {
  const action = CAMEO_ROOT[e.rootCode] ?? `CAMEO ${e.rootCode}`;
  const actors = [e.actor1, e.actor2].filter(Boolean).join(' → ');
  return actors ? `${actors}: ${action}` : action;
}

/** What part of the 1 h GDELT window a /api/gdelt-events answer drew (null when it drew all of it). */
export interface GdeltWindowCoverage {
  served: number;
  total: number;
}

/**
 * Coverage of a /api/gdelt-events body: null when every matching event in the window was served,
 * else how many were served of how many (R3 round-5 MINOR-3: never a silent first-N).
 */
export function gdeltCoverage(body: { items: readonly unknown[]; total?: number; truncated?: boolean }): GdeltWindowCoverage | null {
  const total = body.total ?? body.items.length;
  if (!body.truncated && total <= body.items.length) return null;
  return { served: body.items.length, total: Math.max(total, body.items.length) };
}
