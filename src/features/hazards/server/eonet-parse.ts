/**
 * NASA EONET v3 events → WeatherEvent. Pure; unit-tested. Owner: layers-hazards.
 * EONET answers `Content-Type: application/rss+xml` for JSON (probed 2026-09-30): httpJson parses
 * regardless of the header. Each event's position is its newest geometry; that geometry's `date`
 * is the observation time.
 */
import type { WeatherEvent } from '@/lib/types';

export interface EonetEvent {
  id?: string;
  title?: string;
  link?: string;
  categories?: { id?: string; title?: string }[];
  sources?: { id?: string; url?: string }[];
  geometry?: { date?: string; type?: string; coordinates?: unknown; magnitudeValue?: number | null; magnitudeUnit?: string | null }[];
}

export interface EonetResponse {
  events?: EonetEvent[];
}

const TYPE: Record<string, WeatherEvent['type']> = {
  severeStorms: 'severe_storm',
  volcanoes: 'volcano',
  floods: 'flood',
  drought: 'drought',
  wildfires: 'wildfire',
  seaLakeIce: 'sea_ice',
  snow: 'winter_storm',
  tempExtremes: 'heat',
};

/** Storm severity from its sustained wind (kt): ≥ 64 hurricane-force → high, ≥ 34 gale → medium. */
export function windSeverity(kt: number | null | undefined): WeatherEvent['severity'] {
  if (typeof kt !== 'number' || !Number.isFinite(kt)) return 'medium';
  return kt >= 64 ? 'high' : kt >= 34 ? 'medium' : 'low';
}

function point(g: NonNullable<EonetEvent['geometry']>[number]): [number, number] | null {
  if (g.type === 'Point' && Array.isArray(g.coordinates)) {
    const [lng, lat] = g.coordinates as number[];
    if (typeof lng === 'number' && typeof lat === 'number' && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return [lng, lat];
  }
  if (g.type === 'Polygon' && Array.isArray(g.coordinates)) {
    const ring = (g.coordinates as number[][][])[0] ?? [];
    if (!ring.length) return null;
    const lng = ring.reduce((s, p) => s + (p[0] ?? 0), 0) / ring.length;
    const lat = ring.reduce((s, p) => s + (p[1] ?? 0), 0) / ring.length;
    return [lng, lat];
  }
  return null;
}

/**
 * @param opts.only   keep only these EONET category ids (e.g. ['wildfires'] for the fires supplement)
 * @param opts.skip   drop these category ids (e.g. earthquakes, covered by USGS)
 */
export function normalizeEonet(res: EonetResponse, opts: { only?: string[]; skip?: string[] } = {}): WeatherEvent[] {
  const out: WeatherEvent[] = [];
  for (const e of res.events ?? []) {
    const cat = e.categories?.[0]?.id ?? '';
    if (!e.id || !e.title) continue;
    if (opts.only && !opts.only.includes(cat)) continue;
    if (opts.skip?.includes(cat)) continue;
    const geoms = (e.geometry ?? []).filter((g) => point(g) !== null);
    if (!geoms.length) continue;
    // Newest geometry by date (EONET lists them chronologically, but do not rely on it).
    const g = geoms.reduce((a, b) => (Date.parse(b.date ?? '') > Date.parse(a.date ?? '') ? b : a));
    const [lng, lat] = point(g)!;
    const t = Date.parse(g.date ?? '');
    const type = TYPE[cat] ?? 'other';
    const kt = g.magnitudeUnit === 'kts' ? g.magnitudeValue : null;
    const severity: WeatherEvent['severity'] =
      type === 'severe_storm' ? windSeverity(kt) : type === 'volcano' || type === 'wildfire' || type === 'flood' ? 'medium' : 'low';
    const url = e.sources?.find((s) => typeof s.url === 'string' && /^https?:\/\//.test(s.url))?.url ?? e.link ?? null;
    out.push({
      id: `eonet-${e.id}`,
      lat,
      lng,
      observedAt: Number.isFinite(t) ? new Date(t).toISOString() : null,
      source: 'eonet',
      title: e.title,
      type,
      severity,
      provider: 'NASA EONET',
      expiresAt: null,
      area: e.categories?.[0]?.title ?? null,
      url: url && /^https?:\/\//.test(url) ? url : null,
      geometry: null,
      positionBasis: 'point',
    });
  }
  return out;
}
