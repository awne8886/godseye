import { describe, expect, it } from 'vitest';
import {
  alongTrackKm,
  antimeridianCrossings,
  crossTrackKm,
  destination,
  distanceKm,
  finalBearing,
  geodesicCircle,
  greatCirclePoints,
  inBBox,
  initialBearing,
  isFacing,
  kmToNm,
  midpoint,
  normalizeLng,
  parseBBox,
  pointInPolygon,
  splitAtAntimeridian,
  type LngLatTuple,
} from './geo';

const LHR: LngLatTuple = [-0.461941, 51.4706];
const JFK: LngLatTuple = [-73.7789, 40.639801];
const SYD: LngLatTuple = [151.177, -33.9461];
const SCL: LngLatTuple = [-70.7858, -33.393];
const AKL: LngLatTuple = [174.792, -37.0082];
const EZE: LngLatTuple = [-58.5358, -34.8222];
const SVO: LngLatTuple = [37.4146, 55.9726];
const LAX: LngLatTuple = [-118.408, 33.9425];

describe('great-circle maths (§8 acceptance values)', () => {
  it('LHR→JFK is 5,540 ± 30 km with initial bearing 288 ± 2°', () => {
    expect(distanceKm(LHR, JFK)).toBeGreaterThan(5510);
    expect(distanceKm(LHR, JFK)).toBeLessThan(5570);
    expect(initialBearing(LHR, JFK)).toBeGreaterThan(286);
    expect(initialBearing(LHR, JFK)).toBeLessThan(290);
    expect(finalBearing(LHR, JFK)).toBeGreaterThan(225);
    expect(finalBearing(LHR, JFK)).toBeLessThan(240);
    expect(kmToNm(1.852)).toBeCloseTo(1);
  });

  it('points are continuous (no jumps > 180°) across the antimeridian: SYD→SCL, AKL→EZE', () => {
    for (const [a, b] of [[SYD, SCL], [AKL, EZE]] as const) {
      const pts = greatCirclePoints(a, b, 256);
      expect(pts).toHaveLength(256);
      for (let i = 1; i < pts.length; i++) expect(Math.abs(pts[i]![0] - pts[i - 1]![0])).toBeLessThan(10);
      expect(antimeridianCrossings(pts)).toBe(1);
      const parts = splitAtAntimeridian(pts);
      expect(parts).toHaveLength(2);
      for (const seg of parts) for (const [lng] of seg) expect(Math.abs(lng)).toBeLessThanOrEqual(180);
      // The split point sits exactly on the antimeridian at the same latitude on both sides.
      expect(Math.abs(parts[0]!.at(-1)![0])).toBe(180);
      expect(parts[0]!.at(-1)![1]).toBeCloseTo(parts[1]![0]![1], 9);
    }
  });

  it('SVO→LAX goes over high latitudes (polar arc)', () => {
    const pts = greatCirclePoints(SVO, LAX, 128);
    expect(Math.max(...pts.map((p) => p[1]))).toBeGreaterThan(70);
    expect(antimeridianCrossings(pts)).toBe(0);
  });

  it('interpolation endpoints and midpoint are exact', () => {
    const pts = greatCirclePoints(LHR, JFK, 128);
    expect(pts[0]![0]).toBeCloseTo(LHR[0], 9);
    expect(pts.at(-1)![1]).toBeCloseTo(JFK[1], 9);
    const m = midpoint(LHR, JFK);
    expect(distanceKm(LHR, m)).toBeCloseTo(distanceKm(m, JFK), 6);
  });

  it('cross-track and along-track distances', () => {
    const halfway = midpoint(LHR, JFK);
    expect(Math.abs(crossTrackKm(halfway, LHR, JFK))).toBeLessThan(0.001);
    expect(alongTrackKm(halfway, LHR, JFK)).toBeCloseTo(distanceKm(LHR, JFK) / 2, 3);
    const offTrack = destination(halfway, (initialBearing(halfway, JFK) + 90) % 360, 100);
    expect(Math.abs(crossTrackKm(offTrack, LHR, JFK))).toBeCloseTo(100, 0);
    const behind = destination(LHR, (initialBearing(LHR, JFK) + 180) % 360, 200);
    expect(alongTrackKm(behind, LHR, JFK)).toBeLessThan(0);
  });

  it('far-side test for globe billboards', () => {
    expect(isFacing([0, 0], [10, 10])).toBe(true);
    expect(isFacing([0, 0], [180, 0])).toBe(false);
    expect(isFacing([0, 0], [95, 0])).toBe(false);
  });

  it('geodesic circles close and follow the sphere', () => {
    const ring = geodesicCircle([0, 60], 1000, 64);
    expect(ring).toHaveLength(65);
    expect(ring[0]).toEqual(ring[64]);
    for (const p of ring.slice(0, -1)) expect(distanceKm([0, 60], [normalizeLng(p[0]), p[1]])).toBeCloseTo(1000, 3);
  });

  it('normalises longitudes and handles antimeridian bboxes', () => {
    expect(normalizeLng(190)).toBe(-170);
    expect(normalizeLng(-190)).toBe(170);
    expect(normalizeLng(180)).toBe(180);
    expect(parseBBox('170,-50,-170,-30')).toEqual([170, -50, -170, -30]);
    expect(parseBBox('0,10,10,5')).toBeNull();
    expect(inBBox([175, -40], [170, -50, -170, -30])).toBe(true);
    expect(inBBox([-175, -40], [170, -50, -170, -30])).toBe(true);
    expect(inBBox([0, -40], [170, -50, -170, -30])).toBe(false);
  });

  it('point in polygon with holes', () => {
    const poly: GeoJSON.Polygon = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]] };
    expect(pointInPolygon([2, 2], poly)).toBe(true);
    expect(pointInPolygon([5, 5], poly)).toBe(false);
    expect(pointInPolygon([20, 5], poly)).toBe(false);
  });
});
