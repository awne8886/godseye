/**
 * visual-qa round 5 MAJOR-1 (BLOCKING): a MapLibre 6.11 Map has no `transform`, so the shared
 * `cameraFromMap()` fell back to the map centre and an unpitched altitude; on a tilted globe the
 * hazards layers drew occluded points and hid visible ones. `hazardsCamera()` derives the pitched
 * camera from public API (now via the shared helper, which carries the fix). Reference values: MapLibre's own `_camera.transform.getCameraLngLat()` /
 * `getCameraAltitude()` on the live app at `?proj=globe&c=-4.27,-50.76,3,60,0` after a nudge
 * (round-5 probe, 2026-10-01): centre (-51.286, -3.926), z3, pitch 60, bearing 0, canvas 1000 px
 * high → camera (-51.29, -46.71) at 12,268,631 m; the old fallback answered the centre at 14,618,817 m.
 */
import { describe, expect, it } from 'vitest';
import { centralAngle } from '@/lib/geo';
import { altitudeForZoom, cameraFromMap, isFacing } from '@/lib/map/far-side';
import { hazardsCamera, pitchedCamera, type CameraMapLike } from './camera';

/** The public surface of a MapLibre 6.11 Map: no `transform`. */
function liveLikeMap(o: { lng: number; lat: number; zoom: number; pitch: number; bearing: number; height: number }): CameraMapLike {
  return {
    getCenter: () => ({ lng: o.lng, lat: o.lat }),
    getZoom: () => o.zoom,
    getPitch: () => o.pitch,
    getBearing: () => o.bearing,
    getCanvas: () => ({ clientHeight: o.height }),
  };
}

const PROBE = { lng: -51.286, lat: -3.926, zoom: 3, pitch: 60, bearing: 0, height: 1000 };

describe('hazardsCamera (no map.transform, as on MapLibre 6.11)', () => {
  it('matches MapLibre\'s own camera at pitch 60 (within 0.1° and 0.1 %)', () => {
    const map = liveLikeMap(PROBE);
    expect('transform' in map).toBe(false);
    const cam = hazardsCamera(map);
    expect(Math.abs(cam.lng - -51.29)).toBeLessThan(0.1);
    expect(Math.abs(cam.lat - -46.71)).toBeLessThan(0.1);
    expect(Math.abs(cam.altitude - 12_268_631) / 12_268_631).toBeLessThan(0.001);
  });

  it('pitch 60 changes which points face the camera (points behind the old horizon, and vice versa)', () => {
    const map = liveLikeMap(PROBE);
    const right = hazardsCamera(map);
    // The old fallback: the map centre at the unpitched altitude.
    const wrong = { lng: PROBE.lng, lat: PROBE.lat, altitude: altitudeForZoom(PROBE.lat, PROBE.zoom, PROBE.height) };
    const pts: [number, number][] = [];
    for (let lat = -88; lat <= 88; lat += 4) for (let lng = -178; lng < 180; lng += 4) pts.push([lng, lat]);
    const drawnWrongly = pts.filter((p) => isFacing(p, wrong) && !isFacing(p, right)).length;
    const hiddenWrongly = pts.filter((p) => !isFacing(p, wrong) && isFacing(p, right)).length;
    expect(drawnWrongly).toBeGreaterThan(0);
    expect(hiddenWrongly).toBeGreaterThan(0);
  });

  it('equals the unpitched camera at pitch 0 (same as the host\'s data-far-side)', () => {
    const map = liveLikeMap({ ...PROBE, pitch: 0 });
    const cam = hazardsCamera(map);
    expect(cam).toEqual(cameraFromMap(map));
    expect(cam.altitude).toBeCloseTo(altitudeForZoom(PROBE.lat, PROBE.zoom, PROBE.height), 3);
  });

  it('moves the ground point opposite the bearing', () => {
    const at = (bearing: number) => pitchedCamera({ lng: 10, lat: 0 }, 4, 45, bearing, 900);
    const east = at(90); // looking east: camera west of the centre
    expect(east.lng).toBeLessThan(10);
    expect(east.lat).toBeCloseTo(0, 6);
    const north = at(0);
    expect(north.lat).toBeLessThan(0);
    expect(north.lng).toBeCloseTo(10, 6);
    // Same distance from the centre whatever the bearing.
    expect(centralAngle([10, 0], [east.lng, east.lat])).toBeCloseTo(centralAngle([10, 0], [north.lng, north.lat]), 9);
    expect(east.altitude).toBeCloseTo(north.altitude, 6);
  });

  it('prefers a working map.transform when one exists', () => {
    const map = { ...liveLikeMap(PROBE), transform: { getCameraLngLat: () => ({ lng: 1, lat: 2 }), getCameraAltitude: () => 3 } };
    expect(hazardsCamera(map)).toEqual({ lng: 1, lat: 2, altitude: 3 });
  });
});
