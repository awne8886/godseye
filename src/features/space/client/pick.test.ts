import { describe, expect, it } from 'vitest';
import { EARTH_RADIUS_M, horizonAngleDeg } from '@/lib/map/far-side';
import { displayAltM } from '../lib/orbit-math';
import {
  SAT_HIT_PX,
  SatelliteScreenCache,
  elevatedPoint,
  frameRowFaces,
  hitTestSatellites,
  latestLngLat,
  latestPosition,
  nearestInTable,
  nearestSatellite,
  projectFrame,
  sameCamera,
  type PickFrame,
  type PickView,
} from './pick';

// Mercator-like test surface: 10 px per degree, centre (0,0) at screen (500,500).
const MERCATOR: PickView = { globe: false, camera: null };
const GLOBE_NO_CAMERA: PickView = { globe: true, camera: null };
const map = {
  project: ([lng, lat]: [number, number]) => ({ x: 500 + lng * 10, y: 500 - lat * 10 }),
  getCenter: () => ({ lng: 0, lat: 0 }),
};

function frame(rows: [catIndex: number, lng: number, lat: number, altKm: number][]): PickFrame {
  const positions = new Float32Array(rows.length * 3);
  const index = new Uint32Array(rows.length);
  rows.forEach(([c, lng, lat, alt], k) => {
    positions.set([lng, lat, displayAltM(alt)], k * 3);
    index[k] = c;
  });
  return { count: rows.length, positions, index };
}

describe('satellite picking uses the latest propagated position', () => {
  // The ISS (catalogue row 7) moved 3° east between two 1 Hz frames (exaggerated for the test).
  const older = frame([[7, 10, 20, 420], [2, -40, 5, 20_200]]);
  const newer = frame([[2, -40.1, 5, 20_200], [7, 13, 20, 420]]);

  it('hits the marker where the newest frame draws it, not where it was', () => {
    const now = map.project([13, 20]);
    const hit = nearestSatellite(newer, now, map, MERCATOR);
    expect(hit?.catIndex).toBe(7);
    expect(hit?.lngLat[0]).toBeCloseTo(13);
    // The old screen position is 30 px away from the newest marker: no hit on stale geometry.
    expect(nearestSatellite(newer, map.project([10, 20]), map, MERCATOR)).toBeNull();
  });

  it('maps a GPU pick from an older frame onto the newest position', () => {
    expect(latestLngLat(newer, 7)).toEqual([13, 20]);
    expect(latestLngLat(newer, 99)).toBeNull();
    expect(latestLngLat(null, 7)).toBeNull();
    expect(latestLngLat(older, 7)).toEqual([10, 20]);
    expect(latestPosition(newer, 7)?.[2]).toBeCloseTo(displayAltM(420), -1);
  });

  it('on the globe, tests the elevated (display-altitude) screen point as well as the ground point', () => {
    const f = frame([[4, 30, 0, 20_200]]);
    const e = elevatedPoint(map, 30, 0, displayAltM(20_200), true);
    const g = map.project([30, 0]);
    expect(e.x).toBeGreaterThan(g.x + SAT_HIT_PX); // clearly off the ground point
    expect(nearestSatellite(f, e, map, GLOBE_NO_CAMERA)?.catIndex).toBe(4);
    expect(nearestSatellite(f, g, map, GLOBE_NO_CAMERA)?.catIndex).toBe(4);
    expect(nearestSatellite(f, e, map, MERCATOR)).toBeNull(); // mercator: no radial offset
  });

  it('returns one candidate with its pixel distance, or none', () => {
    const c = hitTestSatellites(newer, { x: 632, y: 300 }, map, MERCATOR, (catIndex, lngLat) => ({
      layer: 'satellites',
      selection: { kind: 'satellite', id: String(catIndex), layer: 'satellites', source: 'celestrak', observedAt: null, data: {}, lngLat },
    }));
    expect(c).toHaveLength(1);
    expect(c[0]!.selection.lngLat).toEqual([13, 20]);
    expect(c[0]!.distancePx).toBeCloseTo(2, 5);
    expect(c[0]!.altitudeM).toBeCloseTo(displayAltM(420), -1);
    expect(hitTestSatellites(null, { x: 0, y: 0 }, map, MERCATOR, () => null)).toEqual([]);
  });
});

/**
 * R2 round 5 MAJOR-2: MapLibre's globe `project()` has no occlusion test, so a satellite behind
 * the globe projects INSIDE the disk and used to win the click over a visible neighbour. Surface:
 * an orthographic globe of 300 px radius centred on (0°, 0°) at screen (500, 500), with no
 * occlusion test (like MapLibre's); camera above (0°, 0°) with a 58.6° horizon (≈ z4).
 */
describe('satellite picking ignores satellites behind the globe', () => {
  const R_PX = 300;
  const globe = {
    project: ([lng, lat]: [number, number]) => ({
      x: 500 + R_PX * Math.cos((lat * Math.PI) / 180) * Math.sin((lng * Math.PI) / 180),
      y: 500 - R_PX * Math.sin((lat * Math.PI) / 180),
    }),
    getCenter: () => ({ lng: 0, lat: 0 }),
  };
  const camera = { lng: 0, lat: 0, altitude: EARTH_RADIUS_M / Math.cos((58.6 * Math.PI) / 180) - EARTH_RADIUS_M };
  const GLOBE: PickView = { globe: true, camera };
  const LEO = 420;
  const GEO = 35_786;
  const leoCap = horizonAngleDeg(camera.altitude) + horizonAngleDeg(displayAltM(LEO));
  const geoCap = horizonAngleDeg(camera.altitude) + horizonAngleDeg(displayAltM(GEO));
  const at = (lng: number, altKm: number) => elevatedPoint(globe, lng, 0, displayAltM(altKm), true);
  const toCandidate = (catIndex: number, lngLat: [number, number]) => ({
    layer: 'satellites',
    selection: { kind: 'satellite' as const, id: String(catIndex), layer: 'satellites' as const, source: 'celestrak', observedAt: null, data: {}, lngLat },
  });

  it('the fixture puts a hidden LEO satellite inside the disk (85° away, behind the ≈ 79° cap)', () => {
    expect(leoCap).toBeGreaterThan(78);
    expect(leoCap).toBeLessThan(85);
    const p = globe.project([85, 0]);
    expect(Math.hypot(p.x - 500, p.y - 500)).toBeLessThan(R_PX); // projects inside the disk
  });

  it('a hidden satellite under the pointer never hides the visible one 5 px away', () => {
    const hidden = at(85, LEO);
    // A visible GEO satellite whose drawn marker is 5 px left of the hidden one.
    const k = 1 + displayAltM(GEO) / EARTH_RADIUS_M;
    const geoLng = (Math.asin((hidden.x - 5 - 500) / (R_PX * k)) * 180) / Math.PI;
    const f = frame([
      [1, 85, 0, LEO],
      [2, geoLng, 0, GEO],
    ]);
    // Without a camera (the old behaviour) the hidden satellite wins: it is nearest.
    expect(nearestSatellite(f, hidden, globe, GLOBE_NO_CAMERA)?.catIndex).toBe(1);
    const hit = nearestSatellite(f, hidden, globe, GLOBE);
    expect(hit?.catIndex).toBe(2);
    expect(hit?.distancePx).toBeCloseTo(5, 2);
  });

  it('a click on a hidden satellite alone selects nothing on the globe, but hits in mercator', () => {
    const f = frame([[1, 85, 0, LEO]]);
    expect(nearestSatellite(f, at(85, LEO), globe, GLOBE)).toBeNull();
    expect(hitTestSatellites(f, at(85, LEO), globe, GLOBE, toCandidate)).toEqual([]);
    expect(nearestSatellite(f, globe.project([85, 0]), globe, MERCATOR)?.catIndex).toBe(1);
  });

  it('a GEO satellite 92° away rises above the limb at its drawn altitude and stays pickable', () => {
    expect(geoCap).toBeGreaterThan(92);
    const c = hitTestSatellites(frame([[3, 92, 0, GEO]]), at(92, GEO), globe, GLOBE, toCandidate);
    expect(c).toHaveLength(1);
    expect(c[0]!.altitudeM).toBeCloseTo(displayAltM(GEO), -1);
  });

  it('frameRowFaces lifts the point by its drawn (display) altitude, not the ground point', () => {
    const f = frame([
      [1, 70, 0, LEO], // ground point beyond the 58.6° horizon, marker above the limb
      [2, 85, 0, LEO],
    ]);
    expect(frameRowFaces(f, 0, GLOBE)).toBe(true);
    expect(frameRowFaces(f, 1, GLOBE)).toBe(false);
    expect(frameRowFaces(f, 1, MERCATOR)).toBe(true);
  });
});

/**
 * Verification round 8 (MAJOR, perf): the host runs every CPU hit-tester on each pointer-move
 * frame, and the satellite hit-test made three MapLibre globe `project()` calls per drawn
 * satellite on every one of them (33 ms of CPU per hover frame with 9k satellites). Now a frame is
 * projected once per (frame, camera), one `project()` per satellite, and a hover between two
 * ticks costs one `project()` (the camera probe) plus a scan of a Float32Array.
 */
describe('hover hit-test cost: one projection per (frame, camera)', () => {
  const R_PX = 300;
  const DEG = Math.PI / 180;
  /** Orthographic globe like the far-side fixture above, with a movable centre and a call counter. */
  function countingGlobe() {
    const state = { centre: { lng: 0, lat: 0 }, zoom: 2.5, calls: 0 };
    const m = {
      project: ([lng, lat]: [number, number]) => {
        state.calls++;
        const dl = (lng - state.centre.lng) * DEG;
        return { x: 500 + R_PX * Math.cos(lat * DEG) * Math.sin(dl), y: 500 - R_PX * Math.sin(lat * DEG) };
      },
      getCenter: () => ({ ...state.centre }),
      getZoom: () => state.zoom,
      getBearing: () => 0,
      getPitch: () => 0,
      getCanvas: () => ({ clientWidth: 1000, clientHeight: 1000 }),
    };
    return { m, state };
  }
  const camera = { lng: 0, lat: 0, altitude: EARTH_RADIUS_M / Math.cos((58.6 * Math.PI) / 180) - EARTH_RADIUS_M };
  const GLOBE: PickView = { globe: true, camera };
  /** n satellites on a lat/lng grid in front of the camera, LEO to GEO. */
  function bigFrame(n: number, cam: PickView['camera'] = camera): PickFrame {
    const rows: [number, number, number, number][] = [];
    for (let i = 0; i < n; i++) rows.push([i, ((i * 7.3) % 100) - 50, ((i * 3.1) % 100) - 50, [420, 1_200, 20_200, 35_786][i % 4]!]);
    return { ...frame(rows), camera: cam };
  }

  it('projectFrame makes one project() per satellite plus one for the globe centre (was three per satellite)', () => {
    const { m, state } = countingGlobe();
    const f = bigFrame(2_000);
    projectFrame(f, m, GLOBE);
    expect(state.calls).toBe(f.count + 1);
  });

  it('the screen table gives exactly the uncached answer (elevated and ground points, far side)', () => {
    const { m } = countingGlobe();
    const f = bigFrame(600, null); // filtered without a camera: the picker must re-test the far side
    const cache = new SatelliteScreenCache();
    for (let x = 200; x <= 800; x += 37) {
      for (let y = 200; y <= 800; y += 41) {
        const a = cache.nearest(f, { x, y }, m, GLOBE);
        const b = nearestSatellite(f, { x, y }, m, GLOBE);
        expect(a?.catIndex ?? null).toBe(b?.catIndex ?? null);
        if (a && b) expect(a.distancePx).toBeCloseTo(b.distancePx, 3);
      }
    }
    expect(cache.builds).toBe(1);
  });

  it('9,000 satellites: 60 hovers on one frame and camera project the frame once, then one probe each', () => {
    const { m, state } = countingGlobe();
    const f = bigFrame(9_000);
    const cache = new SatelliteScreenCache();
    for (let i = 0; i < 60; i++) hitTestSatellites(f, { x: 300 + i * 5, y: 420 }, m, GLOBE, () => null, cache);
    expect(cache.builds).toBe(1);
    // build: 9,000 satellites + the centre; every hover: one camera probe. Before: 3 × 9,000 × 60.
    expect(state.calls).toBe(9_000 + 1 + 60);
  });

  it('a new frame, a camera move, a zoom or a far-side camera change rebuilds the table; nothing else does', () => {
    const { m, state } = countingGlobe();
    const cache = new SatelliteScreenCache();
    const f1 = bigFrame(100);
    const p = { x: 500, y: 500 };
    cache.nearest(f1, p, m, GLOBE);
    cache.nearest(f1, { x: 510, y: 490 }, m, GLOBE);
    expect(cache.builds).toBe(1);
    cache.nearest(bigFrame(100), p, m, GLOBE); // next 1 Hz tick (or a worker re-filter)
    expect(cache.builds).toBe(2);
    const f3 = bigFrame(100);
    cache.nearest(f3, p, m, GLOBE);
    expect(cache.builds).toBe(3);
    state.centre = { lng: 10, lat: 0 };
    cache.nearest(f3, p, m, GLOBE);
    expect(cache.builds).toBe(4);
    state.zoom = 3;
    cache.nearest(f3, p, m, GLOBE);
    expect(cache.builds).toBe(5);
    cache.nearest(f3, p, m, { globe: true, camera: { ...camera, lng: 10 } });
    expect(cache.builds).toBe(6);
    cache.nearest(f3, p, m, { globe: false, camera: null });
    expect(cache.builds).toBe(7);
    cache.nearest(f3, p, m, { globe: false, camera: null });
    expect(cache.builds).toBe(7);
    cache.clear();
    cache.nearest(f3, p, m, { globe: false, camera: null });
    expect(cache.builds).toBe(8);
  });

  it('the cached answer follows the satellite into the next frame (never a stale screen position)', () => {
    const { m } = countingGlobe();
    const cache = new SatelliteScreenCache();
    const older = { ...frame([[7, 10, 20, 420]]), camera };
    const newer = { ...frame([[7, 13, 20, 420]]), camera };
    const at13 = elevatedPoint(m, 13, 20, displayAltM(420), true);
    expect(cache.nearest(older, at13, m, GLOBE)).toBeNull();
    expect(cache.nearest(newer, at13, m, GLOBE)?.catIndex).toBe(7);
  });

  it('the far-side re-test is skipped only for a frame the worker filtered with this very camera', () => {
    const { m } = countingGlobe();
    // 85° east is behind the ≈ 79° LEO cap: the worker would never have drawn it for `camera`.
    const rows: [number, number, number, number][] = [[1, 85, 0, 420]];
    const hiddenPoint = m.project([85, 0]);
    expect(sameCamera(camera, { ...camera })).toBe(true);
    expect(sameCamera(camera, null)).toBe(false);
    expect(sameCamera(null, undefined)).toBe(true);
    // Filtered with another camera (or none): the picker re-tests and drops the hidden row.
    expect(nearestSatellite({ ...frame(rows), camera: { ...camera, lng: 60 } }, hiddenPoint, m, GLOBE)).toBeNull();
    expect(nearestSatellite({ ...frame(rows), camera: null }, hiddenPoint, m, GLOBE)).toBeNull();
    const table = projectFrame({ ...frame(rows), camera: { ...camera, lng: 60 } }, m, GLOBE);
    expect(Number.isNaN(table[0]!)).toBe(true);
    // Same camera: the worker's filter already applied, so the row is projected without a re-test.
    expect(Number.isNaN(projectFrame({ ...frame(rows), camera: { ...camera } }, m, GLOBE)[0]!)).toBe(false);
    expect(nearestInTable(new Float32Array([Number.NaN, Number.NaN, Number.NaN, Number.NaN]), 1, { x: 0, y: 0 })).toBeNull();
  });
});
