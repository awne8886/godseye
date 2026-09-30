/**
 * Isomorphic helpers for the hazards layers: visual scales, colour buckets (as map tokens) and
 * Intel Feed event mappers. Pure; unit-tested. Owner: layers-hazards.
 */
import { fieldIndex, type Cell } from '@/lib/columnar';
import { FIRE_FIELDS } from '@/lib/schemas/hazards';
import type { MapToken } from '@/lib/tokens';
import type { AirQuality, Earthquake, FeedEvent, GpsJamCell, WeatherEvent } from '@/lib/types';

/**
 * Magnitude ring radius in km — a display scale, not a felt or damage area: 20 km at M2.5,
 * doubling per magnitude unit, capped at 1 200 km.
 */
export function magnitudeRingKm(magnitude: number): number {
  return Math.min(1200, 20 * 2 ** Math.max(0, magnitude - 2.5));
}

/** Point radius in screen pixels for a quake. */
export function quakeRadiusPx(magnitude: number): number {
  return Math.max(2.5, Math.min(14, 2.5 + (magnitude - 2.5) * 2.2));
}

export function quakeToken(magnitude: number): MapToken {
  return magnitude >= 6 ? '--map-seismic-high' : magnitude >= 4 ? '--map-seismic' : '--map-seismic-low';
}

/** Fire point radius in pixels from FRP (MW): square-root scale, 1.5–7 px. */
export function fireRadiusPx(frpMw: number | null): number {
  if (frpMw === null || !(frpMw > 0)) return 1.5;
  return Math.min(7, 1.5 + Math.sqrt(frpMw) / 6);
}

export const FIRE_CONFIDENCE_ALPHA = { low: 0.35, nominal: 0.7, high: 0.95 } as const;

/** US AQI category (EPA breakpoints) with a map token per bucket. */
export function aqiCategory(usAqi: number | null): { label: string; token: MapToken } {
  if (usAqi === null) return { label: 'UNKNOWN', token: '--map-flight-unknown' };
  if (usAqi <= 50) return { label: 'GOOD', token: '--map-air-quality' };
  if (usAqi <= 100) return { label: 'MODERATE', token: '--map-seismic-low' };
  if (usAqi <= 150) return { label: 'UNHEALTHY FOR SENSITIVE GROUPS', token: '--map-fire' };
  if (usAqi <= 200) return { label: 'UNHEALTHY', token: '--map-seismic-high' };
  if (usAqi <= 300) return { label: 'VERY UNHEALTHY', token: '--map-malware-ring' };
  return { label: 'HAZARDOUS', token: '--map-volcano' };
}

/** gpsjam's own colour thresholds: ≤ 2 % low, ≤ 10 % medium, above that high. */
export function jamLevel(cell: Pick<GpsJamCell, 'badRatio'>): { label: 'LOW' | 'MEDIUM' | 'HIGH'; token: MapToken; alpha: number } {
  if (cell.badRatio > 0.1) return { label: 'HIGH', token: '--map-seismic-high', alpha: 0.62 };
  if (cell.badRatio > 0.02) return { label: 'MEDIUM', token: '--map-seismic-low', alpha: 0.5 };
  return { label: 'LOW', token: '--map-air-quality', alpha: 0.35 };
}

export function weatherToken(e: Pick<WeatherEvent, 'type'>): MapToken {
  switch (e.type) {
    case 'volcano':
      return '--map-volcano';
    case 'wildfire':
    case 'heat':
      return '--map-fire';
    case 'flood':
      return '--map-cable';
    default:
      return '--map-weather';
  }
}

export const SEVERITY_RADIUS_PX = { low: 4, medium: 6, high: 8 } as const;

// ── Intel Feed events ─────────────────────────────────────────────────────────────
/** A quake is feed-worthy at M ≥ 4.5, with a PAGER alert, a tsunami flag or significance ≥ 600. */
export function isSignificantQuake(q: Earthquake): boolean {
  return q.magnitude >= 4.5 || q.alert !== null || q.tsunami || (q.significance ?? 0) >= 600;
}

export function quakeEvents(items: readonly Earthquake[]): FeedEvent[] {
  const out: FeedEvent[] = [];
  for (const q of items) {
    if (!q.observedAt || !isSignificantQuake(q)) continue;
    const severity: FeedEvent['severity'] = q.alert === 'red' || q.magnitude >= 7 ? 'critical' : q.alert === 'orange' || q.magnitude >= 6 ? 'high' : q.tsunami || q.magnitude >= 5 ? 'medium' : 'low';
    out.push({
      // Unique within the layer; a USGS id is stable across revisions.
      id: q.id,
      layer: 'earthquakes',
      entityKind: 'earthquake',
      entityId: q.id,
      title: `M${q.magnitude.toFixed(1)} ${q.place ?? 'earthquake'}`,
      detail: [q.depthKm !== null ? `${q.depthKm.toFixed(0)} km deep` : null, q.tsunami ? 'tsunami flag' : null, q.alert ? `PAGER ${q.alert.toUpperCase()}` : null].filter(Boolean).join(' · ') || undefined,
      severity,
      observedAt: q.observedAt,
      lat: q.lat,
      lng: q.lng,
      source: 'USGS',
    });
  }
  return out;
}

export function weatherEvents(items: readonly WeatherEvent[]): FeedEvent[] {
  const out: FeedEvent[] = [];
  for (const e of items) {
    if (!e.observedAt || e.severity !== 'high') continue;
    out.push({
      id: e.id,
      layer: 'weather',
      entityKind: 'weather_event',
      entityId: e.id,
      title: e.title,
      detail: e.area ?? undefined,
      severity: 'high',
      observedAt: e.observedAt,
      lat: e.lat,
      lng: e.lng,
      source: e.provider,
    });
  }
  return out;
}

/** Intense fires only (FRP ≥ 1 000 MW), strongest 10, so the feed is not flooded. */
export function fireEvents(rows: readonly { id: string; lat: number; lng: number; frpMw: number | null; seenAt: number; satellite: string }[]): FeedEvent[] {
  return rows
    .filter((r) => (r.frpMw ?? 0) >= 1000)
    .slice(0, 10)
    .map((r) => ({
      id: r.id,
      layer: 'fires',
      entityKind: 'fire' as const,
      entityId: r.id,
      title: `Intense fire · ${Math.round(r.frpMw!).toLocaleString('en-US')} MW`,
      detail: `${r.satellite} overpass`,
      severity: (r.frpMw! >= 3000 ? 'high' : 'medium') as FeedEvent['severity'],
      observedAt: new Date(r.seenAt * 1000).toISOString(),
      lat: r.lat,
      lng: r.lng,
      source: 'NASA FIRMS',
    }));
}

export function aqLabel(a: AirQuality): string {
  return a.station ?? `${a.lat.toFixed(2)}, ${a.lng.toFixed(2)}`;
}

// ── FIRE_FIELDS rows ─────────────────────────────────────────────────────────────
export const FIRE_IDX = fieldIndex(FIRE_FIELDS);
const IDX = FIRE_IDX;

/** One columnar fire row → the object a card shows (observedAt = overpass time). */
export function fireRowObject(row: readonly Cell[]) {
  const seenAt = row[IDX.seenAt] as number;
  return {
    id: row[IDX.id] as string,
    lat: row[IDX.lat] as number,
    lng: row[IDX.lng] as number,
    frpMw: row[IDX.frpMw] as number | null,
    brightnessK: row[IDX.brightnessK] as number | null,
    confidence: row[IDX.confidence] as 'low' | 'nominal' | 'high',
    dayNight: row[IDX.dayNight] as 'D' | 'N' | null,
    satellite: row[IDX.satellite] as string,
    seenAt,
    observedAt: new Date(seenAt * 1000).toISOString(),
    source: 'firms',
  };
}

