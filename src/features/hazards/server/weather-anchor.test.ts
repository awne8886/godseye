/**
 * r11: a zone-placed NWS alert's marker lies on its zone. The area centroid of a concave
 * (coastal/marine, C-shaped) zone falls outside it, so the anchor falls back to the pole of
 * inaccessibility; the busy-day zones (real NWS outlines) are all checked.
 */
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { fixtureBuffer } from './__fixtures__';
import { geometryAnchor, normalizeNws, pointInPolygon, poleOfInaccessibility, ringCentroid, type NwsCollection, type ZoneGeom } from './weather-parse';

type Geo = GeoJSON.Polygon | GeoJSON.MultiPolygon;

/** A "C" opening east: 2°×2° box around (cx, cy) with a 1.6°×1.2° bite out of its east side. */
const cShape = (cx: number, cy: number): GeoJSON.Position[] =>
  [
    [-1, -1],
    [1, -1],
    [1, -0.6],
    [-0.6, -0.6],
    [-0.6, 0.6],
    [1, 0.6],
    [1, 1],
    [-1, 1],
    [-1, -1],
  ].map(([x, y]) => [cx + x!, cy + y!]);

const polygons = (g: Geo) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);
const onGeometry = (pt: [number, number], g: Geo) => polygons(g).some((p) => pointInPolygon(pt, p));

describe('weather marker anchors', () => {
  const ring = cShape(-165, 54);

  it('the C-shaped zone has its area centroid outside it (the r11 bug)', () => {
    const c = ringCentroid(ring)!;
    expect(pointInPolygon(c, [ring])).toBe(false);
  });

  it('the pole of inaccessibility of a C lies inside it, away from its edges', () => {
    const p = poleOfInaccessibility([ring])!;
    expect(pointInPolygon(p, [ring])).toBe(true);
    // The deepest part of the C is its 0.4°-wide spine or a corner block: ≥ 0.15° from every edge.
    expect(p[0]).toBeLessThan(-165 - 0.6 + 0.01);
  });

  it('keeps the centroid when it is on the polygon, and respects holes', () => {
    const square: GeoJSON.Polygon = { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] };
    expect(geometryAnchor(square)).toEqual([1, 1]);
    const donut: GeoJSON.Polygon = { type: 'Polygon', coordinates: [square.coordinates[0]!, [[0.5, 0.5], [1.5, 0.5], [1.5, 1.5], [0.5, 1.5], [0.5, 0.5]]] };
    const a = geometryAnchor(donut)!;
    expect(pointInPolygon(a, donut.coordinates)).toBe(true);
  });

  it('places a zone-only alert on its concave zone, not at the centroid', () => {
    const url = 'https://api.weather.gov/zones/forecast/PKZ768';
    const zone: ZoneGeom = { id: 'PKZ768', name: 'C zone', centroid: ringCentroid(ring)!, geometry: { type: 'Polygon', coordinates: [ring] } };
    const fc: NwsCollection = {
      features: [{ geometry: null, properties: { id: 'urn:oid:c.1', event: 'Small Craft Advisory', sent: '2026-10-02T14:03:00-08:00', affectedZones: [url], geocode: { UGC: ['PKZ768'] } } }],
    };
    const { items, zones } = normalizeNws(fc, new Map([[url, zone]]));
    expect(items).toHaveLength(1);
    const e = items[0]!;
    expect(e.positionBasis).toBe('zone-centroid');
    expect(onGeometry([e.lng, e.lat], zones.PKZ768!)).toBe(true);
    expect(onGeometry([e.lng, e.lat], zone.geometry)).toBe(true);
  });

  it('places every marker on one of its zones for real NWS outlines (busy-day fixture)', () => {
    const recorded = JSON.parse(gunzipSync(fixtureBuffer('nws-zones-busy.2026-10-02.json.gz')).toString('utf8')) as Record<string, { id: string; name: string | null; geometry: Geo }>;
    const urls = Object.keys(recorded);
    const zones = new Map<string, ZoneGeom>(urls.map((u) => [u, { ...recorded[u]!, centroid: ringCentroid(polygons(recorded[u]!.geometry)[0]![0]!)! }]));
    const fc: NwsCollection = {
      features: urls.map((u, i) => ({ geometry: i % 5 === 0 ? recorded[u]!.geometry : null, properties: { id: `urn:oid:z.${i}`, event: 'Flood Watch', affectedZones: [u], geocode: { UGC: [recorded[u]!.id] } } })),
    };
    const { items, zones: shapes } = normalizeNws(fc, zones);
    expect(items).toHaveLength(urls.length);
    for (const e of items) {
      const g = e.geometry ?? e.zoneRefs!.map((k) => shapes[k]!).find((s) => onGeometry([e.lng, e.lat], s));
      expect(g && onGeometry([e.lng, e.lat], g), `${e.id} at ${e.lat},${e.lng}`).toBe(true);
    }
  });
});
