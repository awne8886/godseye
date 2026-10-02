/**
 * r10: /api/weather stays under the 4 MB response cap on a busy NWS day. Zone outlines are thinned
 * for display (Douglas-Peucker after rounding, per-outline vertex cap) and sent once in a shared
 * `zones` map; the body builder re-thins further if it would still pass the cap, never dropping an
 * alert. The busy-day fixture is built from real NWS zone shapes (see the fixture comment).
 */
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { MAX_RESPONSE_BYTES } from '@/lib/respond';
import { WeatherResponse } from '@/lib/schemas';
import { withFootprints } from '../shared';
import { FX, fixtureBuffer, fixtureJson } from './__fixtures__';
import { weatherBody, type WeatherData } from './weather';
import { MAX_OUTLINE_VERTICES, normalizeNws, simplifyGeometry, simplifyRing, thinGeometry, vertexCount, zoneKey, type NwsCollection, type NwsFeature, type ZoneGeom } from './weather-parse';

type Geo = GeoJSON.Polygon | GeoJSON.MultiPolygon;

/** A wiggly closed ring: `n` vertices around a circle of radius `r` degrees with 0.002° noise-free ripple. */
const circle = (n: number, r: number, cx = -97, cy = 32): GeoJSON.Position[] => {
  const out: GeoJSON.Position[] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    const rr = r + 0.002 * Math.sin(a * 40);
    out.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
  }
  out.push([...out[0]!]);
  return out;
};
const closed = (r: GeoJSON.Position[]) => r.length >= 4 && r[0]![0] === r.at(-1)![0] && r[0]![1] === r.at(-1)![1];

describe('display thinning', () => {
  it('Douglas-Peucker thins a dense ring and keeps it closed and valid', () => {
    const ring = circle(2000, 0.5);
    const thin = simplifyRing(simplifyGeometry({ type: 'Polygon', coordinates: [ring] }).coordinates[0] as GeoJSON.Position[], 0.01);
    expect(thin.length).toBeLessThan(80);
    expect(closed(thin)).toBe(true);
  });

  it('never collapses a zone smaller than the tolerance', () => {
    const tiny = circle(30, 0.003);
    const g = thinGeometry({ type: 'Polygon', coordinates: [tiny] }, 0.01, 400, 4) as GeoJSON.Polygon;
    expect(g.coordinates[0]!.length).toBe(4);
    expect(closed(g.coordinates[0]!)).toBe(true);
    // Every part of a MultiPolygon survives (islands included).
    const multi: GeoJSON.MultiPolygon = { type: 'MultiPolygon', coordinates: [[circle(500, 0.4)], [circle(12, 0.004, -96)], [circle(12, 0.004, -95)]] };
    const t = thinGeometry(multi) as GeoJSON.MultiPolygon;
    expect(t.coordinates).toHaveLength(3);
    for (const p of t.coordinates) for (const r of p) expect(closed(r)).toBe(true);
  });

  it('caps the vertices of one outline by coarsening the tolerance', () => {
    const big: GeoJSON.Polygon = { type: 'Polygon', coordinates: [circle(20000, 3)] };
    expect(vertexCount(thinGeometry(big, 0.0001, MAX_OUTLINE_VERTICES))).toBeLessThanOrEqual(MAX_OUTLINE_VERTICES);
  });

  it('keys fire zones apart from forecast zones that share a UGC code', () => {
    expect(zoneKey('https://api.weather.gov/zones/forecast/CAZ211', { id: 'CAZ211' })).toBe('CAZ211');
    expect(zoneKey('https://api.weather.gov/zones/county/ILC007', { id: 'ILC007' })).toBe('ILC007');
    expect(zoneKey('https://api.weather.gov/zones/fire/CAZ211', { id: 'CAZ211' })).toBe('fire/CAZ211');
  });
});

/**
 * Busy-day fixture: 1,200 NWS alerts over the real zone outlines in `nws-zones-busy.2026-10-02.json.gz`
 * (forecast zones of 20 central/eastern states + county zones of TX/OK/KS/GA, recorded with curl
 * from api.weather.gov/zones/{type}/{id} on 2026-10-02 and stored as the zone cache holds them:
 * rounded to 2 decimals). Alert text is cycled from the recorded 2026-09-30 active-alerts payload.
 * Selection is deterministic (index arithmetic): alert i covers 1–12 consecutive zones, every
 * 6th alert carries its own polygon (a storm-based warning), as on an outbreak day.
 */
function busyDay(): { fc: NwsCollection; zones: Map<string, ZoneGeom> } {
  const recorded = JSON.parse(gunzipSync(fixtureBuffer('nws-zones-busy.2026-10-02.json.gz')).toString('utf8')) as Record<string, { id: string; name: string | null; geometry: Geo }>;
  const urls = Object.keys(recorded);
  const zones = new Map<string, ZoneGeom>(urls.map((u) => [u, { ...recorded[u]!, centroid: [0, 0] }]));
  const templates = (fixtureJson<NwsCollection>(FX.nws).features ?? []).filter((f) => f.properties?.event);
  const features: NwsFeature[] = [];
  for (let i = 0; i < 1200; i++) {
    const t = templates[i % templates.length]!;
    const start = (i * 37) % urls.length;
    const affected = Array.from({ length: 1 + (i % 12) }, (_, k) => urls[(start + k) % urls.length]!);
    const own = i % 6 === 0 ? recorded[urls[(i * 13) % urls.length]!]!.geometry : null;
    features.push({
      geometry: own,
      properties: {
        ...t.properties,
        id: `urn:oid:busy.${i}`,
        affectedZones: affected,
        geocode: { UGC: affected.map((u) => u.split('/').pop()!) },
      },
    });
  }
  return { fc: { features }, zones };
}

describe('busy-day /api/weather body', () => {
  const { fc, zones } = busyDay();
  const nws = normalizeNws(fc, zones);

  it('places every alert and shares each zone outline once', () => {
    expect(fc.features!.length).toBeGreaterThanOrEqual(1000);
    expect(nws.items.length + nws.unplaced).toBe(fc.features!.length);
    expect(nws.unplaced).toBe(0);
    expect(Object.keys(nws.zones).length).toBeGreaterThan(800);
    // Capped per outline; only a zone of many islands can stay above it (each ring keeps ≥ 4 positions).
    for (const g of Object.values(nws.zones)) {
      const rings = g.type === 'Polygon' ? g.coordinates.length : g.coordinates.reduce((s, p) => s + p.length, 0);
      expect(vertexCount(g)).toBeLessThanOrEqual(Math.max(MAX_OUTLINE_VERTICES, 4 * rings));
    }
  });

  it('stays under MAX_RESPONSE_BYTES (the pre-r10 inline body did not)', () => {
    const data: WeatherData = { items: nws.items, unplacedAlerts: nws.unplaced, zones: nws.zones, answered: true };
    const body = weatherBody(data);
    expect(body.items).toHaveLength(nws.items.length);
    const meta = { feed: 'weather', kind: 'live', state: 'live', fetchedAt: '2026-10-02T00:00:00.000Z', observedAt: '2026-10-02T00:00:00.000Z', ttlSeconds: 300, attribution: [] };
    const providers = Object.fromEntries(['eonet', 'nws', 'gdacs', 'nhc', 'nhc_cones', 'gvp'].map((k) => [k, { ok: true, count: 1200, ms: 15000, age_s: 300 }]));
    const bytes = Buffer.byteLength(JSON.stringify({ ...body, meta, providers }));
    expect(bytes).toBeLessThan(MAX_RESPONSE_BYTES);
    expect(WeatherResponse.pick({ items: true, unplacedAlerts: true, zones: true }).safeParse(body).success).toBe(true);

    // Before r10 every alert inlined the rounded MultiPolygon of all its zones.
    const inline = fc.features!.reduce((s, f) => {
      const g = f.geometry ?? { type: 'MultiPolygon', coordinates: (f.properties!.affectedZones ?? []).flatMap((u) => { const z = zones.get(u)!.geometry; return z.type === 'Polygon' ? [z.coordinates] : z.coordinates; }) };
      return s + JSON.stringify(g).length;
    }, 0);
    expect(inline).toBeGreaterThan(MAX_RESPONSE_BYTES);
    console.info(`busy-day /api/weather: ${fc.features!.length} alerts, ${Object.keys(body.zones).length} shared zones, ${bytes} B (inline geometry alone was ${inline} B)`);
  });

  it('the client rebuilds every zone footprint from the shared map', () => {
    const resolved = withFootprints(nws.items, nws.zones);
    for (const e of resolved) expect(e.geometry).not.toBeNull();
    const z = resolved.find((e) => e.zoneRefs?.length === 3)!;
    const parts = z.zoneRefs!.reduce((s, k) => s + (nws.zones[k]!.type === 'Polygon' ? 1 : (nws.zones[k] as GeoJSON.MultiPolygon).coordinates.length), 0);
    expect((z.geometry as GeoJSON.MultiPolygon).coordinates).toHaveLength(parts);
  });

  it('re-thins instead of dropping alerts when the outlines alone would pass the budget', () => {
    const data: WeatherData = { items: nws.items, unplacedAlerts: 0, zones: nws.zones, answered: true };
    const tight = weatherBody(data, 1_800_000);
    expect(tight.items).toHaveLength(nws.items.length);
    expect(Object.keys(tight.zones)).toEqual(Object.keys(nws.zones));
    expect(Buffer.byteLength(JSON.stringify(tight))).toBeLessThan(1_800_000);
  });
});
