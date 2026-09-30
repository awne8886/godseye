/**
 * USGS GeoJSON → Earthquake. Pure; unit-tested against a recorded feed. Owner: layers-hazards.
 */
import type { Earthquake } from '@/lib/types';

export interface UsgsFeature {
  id?: string;
  properties?: {
    mag?: number | null;
    magType?: string | null;
    place?: string | null;
    time?: number | null;
    url?: string | null;
    felt?: number | null;
    alert?: string | null;
    tsunami?: number | null;
    sig?: number | null;
    type?: string | null;
  };
  geometry?: { type?: string; coordinates?: (number | null)[] } | null;
}

export interface UsgsCollection {
  features?: UsgsFeature[];
}

const ALERTS = new Set(['green', 'yellow', 'orange', 'red']);

export function normalizeUsgs(fc: UsgsCollection): Earthquake[] {
  const out: Earthquake[] = [];
  const seen = new Set<string>();
  for (const f of fc.features ?? []) {
    const p = f.properties ?? {};
    const c = f.geometry?.coordinates ?? [];
    const lng = c[0];
    const lat = c[1];
    const id = f.id;
    if (!id || seen.has(id) || typeof lat !== 'number' || typeof lng !== 'number' || typeof p.mag !== 'number') continue;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    seen.add(id);
    const alert = typeof p.alert === 'string' ? p.alert.toLowerCase() : null;
    out.push({
      id,
      lat,
      lng,
      observedAt: typeof p.time === 'number' && Number.isFinite(p.time) ? new Date(p.time).toISOString() : null,
      source: 'usgs',
      magnitude: p.mag,
      magType: p.magType ?? null,
      depthKm: typeof c[2] === 'number' ? c[2] : null,
      place: p.place ?? null,
      url: typeof p.url === 'string' && /^https:\/\//.test(p.url) ? p.url : null,
      tsunami: p.tsunami === 1,
      felt: typeof p.felt === 'number' && p.felt >= 0 ? Math.round(p.felt) : null,
      alert: alert && ALERTS.has(alert) ? (alert as Earthquake['alert']) : null,
      significance: typeof p.sig === 'number' ? Math.round(p.sig) : null,
    });
  }
  return out.sort((a, b) => (b.observedAt ?? '').localeCompare(a.observedAt ?? ''));
}

