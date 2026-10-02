/**
 * Submarine cables + landing points (REFERENCE, bundled). Owner: layers-threats-network. Server-only.
 *
 * Source: TeleGeography Submarine Cable Map api/v3 `cable-geo.json` (751 KB, 730 features) and
 * `landing-point-geo.json` (361 KB, 1 925 points), probed 2026-09-30 (200, no CORS,
 * Last-Modified 2026-09-22). Bundled as public/data/cables.json (segments merged per cable id,
 * coordinates rounded to 0.001°). Licence CC BY-NC-SA 3.0 → served only with `nc_sources`.
 * The geo files carry no RFS year, length, owners or cable↔landing links; those stay null
 * rather than being guessed.
 */
import 'server-only';
import { hasCapability } from '@/lib/capabilities';
import { defineFeed, skippedProvider } from '@/lib/feeds';
import type { LandingPoint, SubmarineCable } from '@/lib/types';
import { readRef } from '../../threats/server/refdata';

interface CablesFile {
  _meta: { prepared: string; upstreamLastModified?: string };
  cables: { id: string; name: string; color: string | null; lines: [number, number][][] }[];
  landingPoints: { id: string; name: string; lat: number; lng: number }[];
}

const HEX = /^#[0-9a-f]{6}$/i;

export function loadCables(file: CablesFile = readRef<CablesFile>('cables.json')): { cables: SubmarineCable[]; landingPoints: LandingPoint[] } {
  const cables: SubmarineCable[] = file.cables.map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color && HEX.test(c.color) ? c.color : null,
    geometry: { type: 'MultiLineString', coordinates: c.lines },
    landingPointIds: [],
    rfsYear: null,
    lengthKm: null,
    owners: null,
    url: /^[a-z0-9-]+$/.test(c.id) ? `https://www.submarinecablemap.com/submarine-cable/${c.id}` : null,
  }));
  const landingPoints: LandingPoint[] = file.landingPoints.map((p) => {
    const comma = p.name.lastIndexOf(',');
    return { id: `lp-${p.id}`, lat: p.lat, lng: p.lng, observedAt: null, source: 'telegeography', name: p.name, country: comma > 0 ? p.name.slice(comma + 1).trim() : null };
  });
  return { cables, landingPoints };
}

export const cablesFeed = defineFeed<{ cables: SubmarineCable[]; landingPoints: LandingPoint[] }>({
  key: 'cables',
  ttlMs: 24 * 60 * 60_000,
  kind: 'reference',
  attribution: [{ text: 'Submarine cables: TeleGeography Submarine Cable Map (bundled 2026-09-30)', url: 'https://www.submarinecablemap.com/', licence: 'CC BY-NC-SA 3.0' }],
  count: (d) => d.cables.length,
  gates: ['nc_sources'],
  run: async () => {
    if (!hasCapability('nc_sources')) return { data: { cables: [], landingPoints: [] }, providers: { telegeography: skippedProvider('licence') } };
    const data = loadCables();
    return { data, providers: { telegeography: { status: { ok: true, count: data.cables.length, ms: 0, age_s: 0 }, okAt: Date.now() } } };
  },
});
