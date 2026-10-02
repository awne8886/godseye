import { describe, expect, it } from 'vitest';
import { altitudeForZoom, cameraFromMap, EARTH_RADIUS_M, getFarSideCamera, horizonAngleDeg, isFacing, setFarSideCamera } from './far-side';

describe('horizon angle', () => {
  it('is acos(R / (R + h))', () => {
    expect(horizonAngleDeg(0)).toBe(0);
    expect(horizonAngleDeg(-5)).toBe(0);
    expect(horizonAngleDeg(EARTH_RADIUS_M)).toBeCloseTo(60, 6); // R/(2R) → 60°
    expect(horizonAngleDeg(400_000)).toBeCloseTo(19.8, 1); // ISS altitude
    expect(horizonAngleDeg(Infinity)).toBe(90);
  });
});

describe('isFacing', () => {
  const cam = { lng: 0, lat: 0, altitude: EARTH_RADIUS_M }; // horizon 60°

  it('shows points inside the horizon cap and hides the far side', () => {
    expect(isFacing([0, 0], cam)).toBe(true);
    expect(isFacing([59, 0], cam)).toBe(true);
    expect(isFacing([61, 0], cam)).toBe(false);
    expect(isFacing({ lng: 180, lat: 0 }, cam)).toBe(false);
    expect(isFacing([0, -59.9], cam)).toBe(true);
  });

  it('handles the antimeridian and unwrapped longitudes', () => {
    const pacific = { lng: 179, lat: 0, altitude: EARTH_RADIUS_M };
    expect(isFacing([-179, 0], pacific)).toBe(true); // 2° away across ±180
    expect(isFacing([181, 0], pacific)).toBe(true); // unwrapped −179
    expect(isFacing([-121.5, 0], pacific)).toBe(true); // 59.5° east across the line
    expect(isFacing([-110, 0], pacific)).toBe(false);
    expect(isFacing([0, 0], { ...pacific, lng: 539 })).toBe(false); // camera lng wrapped too
  });

  it('lets elevated objects (satellites) rise over the limb first', () => {
    expect(isFacing([75, 0], cam)).toBe(false);
    expect(isFacing([75, 0], cam, 400_000)).toBe(true); // 60° + 19.8°
  });

  it('treats a null camera (mercator) as always facing', () => {
    expect(isFacing([180, 0], null)).toBe(true);
  });

  it('publishes the host camera for modules', () => {
    setFarSideCamera(cam);
    expect(getFarSideCamera()).toBe(cam);
    setFarSideCamera(null);
    expect(getFarSideCamera()).toBeNull();
  });
});

describe('camera from map', () => {
  it('reads the transform when available (pitch-aware camera ground point)', () => {
    const map = {
      transform: { getCameraLngLat: () => ({ lng: 190, lat: 10 }), getCameraAltitude: () => 5e6 },
      getCenter: () => ({ lng: 0, lat: 0 }),
      getZoom: () => 2,
    };
    expect(cameraFromMap(map)).toEqual({ lng: -170, lat: 10, altitude: 5e6 });
  });
  it('falls back to centre + zoom-derived altitude', () => {
    const map = { getCenter: () => ({ lng: 10, lat: 0 }), getZoom: () => 2, getCanvas: () => ({ clientHeight: 1000 }) };
    const c = cameraFromMap(map);
    expect(c.lng).toBe(10);
    expect(c.altitude).toBeCloseTo(altitudeForZoom(0, 2, 1000), 6);
    expect(altitudeForZoom(0, 0, 512)).toBeCloseTo(1.5 * 512 * ((2 * Math.PI * EARTH_RADIUS_M) / 512), 3);
  });

  // Independent check: place the camera in Earth-centred coordinates (unit radius) and read its
  // sub-point and height back, instead of re-using the module's planar formula.
  function ecefCamera(lng: number, lat: number, zoom: number, pitch: number, bearing: number, H: number) {
    const r = Math.PI / 180;
    const [λ, φ, p, b] = [lng * r, lat * r, pitch * r, bearing * r];
    type V = [number, number, number];
    const n: V = [Math.cos(φ) * Math.cos(λ), Math.cos(φ) * Math.sin(λ), Math.sin(φ)];
    const north: V = [-Math.sin(φ) * Math.cos(λ), -Math.sin(φ) * Math.sin(λ), Math.cos(φ)];
    const east: V = [-Math.sin(λ), Math.cos(λ), 0];
    const d = altitudeForZoom(lat, zoom, H) / EARTH_RADIUS_M;
    const comb = (f: (a: number, b: number, c: number) => number): V => [f(n[0], north[0], east[0]), f(n[1], north[1], east[1]), f(n[2], north[2], east[2])];
    // camera = n + d·(cos p·n − sin p·(cos b·north + sin b·east))
    const [x, y, z] = comb((ni, no, ea) => ni + d * (Math.cos(p) * ni - Math.sin(p) * (Math.cos(b) * no + Math.sin(b) * ea)));
    const len = Math.hypot(x, y, z);
    return { lng: Math.atan2(y, x) / r, lat: Math.asin(z / len) / r, altitude: (len - 1) * EARTH_RADIUS_M };
  }

  it('moves the camera behind the centre when the map is pitched (no transform: public API only)', () => {
    const map = { getCenter: () => ({ lng: 0, lat: 0 }), getZoom: () => 2, getPitch: () => 60, getBearing: () => 0, getCanvas: () => ({ clientHeight: 1000 }) };
    const c = cameraFromMap(map);
    const want = ecefCamera(0, 0, 2, 60, 0, 1000);
    expect(c.lng).toBeCloseTo(0, 6);
    expect(c.lat).toBeLessThan(-45); // camera looks north, so it sits far south of the centre
    expect(c.lat).toBeCloseTo(want.lat, 4);
    expect(c.altitude / want.altitude).toBeCloseTo(1, 6);
    // Tilting lowers the camera (its height is no longer the full camera-to-centre distance).
    expect(c.altitude).toBeLessThan(altitudeForZoom(0, 2, 1000));
    // The old centre-based camera got both sides of the limb wrong at this tilt.
    const centre = { lng: 0, lat: 0, altitude: altitudeForZoom(0, 2, 1000) };
    expect(isFacing([0, 30], centre)).toBe(true);
    expect(isFacing([0, 30], c)).toBe(false); // beyond the real horizon, past the look-at point
    expect(isFacing([180, -60], centre)).toBe(false);
    expect(isFacing([180, -60], c)).toBe(true); // over the south pole, under the camera's view
    expect(isFacing([0, 10], c)).toBe(true);
  });

  it("matches MapLibre's own camera on a tilted globe (round-5 live probe)", () => {
    // MapLibre 6.11 internal getCameraLngLat()/getCameraAltitude() at ?proj=globe&c=-4.27,-50.76,3,60,0
    // (2026-10-01, hazards round-5 probe): centre (-51.286, -3.926), z3, pitch 60, bearing 0, canvas
    // 1000 px high → camera (-51.29, -46.71) at 12,268,631 m.
    const map = { getCenter: () => ({ lng: -51.286, lat: -3.926 }), getZoom: () => 3, getPitch: () => 60, getBearing: () => 0, getCanvas: () => ({ clientHeight: 1000 }) };
    const c = cameraFromMap(map);
    expect(Math.abs(c.lng - -51.29)).toBeLessThan(0.1);
    expect(Math.abs(c.lat - -46.71)).toBeLessThan(0.1);
    expect(Math.abs(c.altitude - 12_268_631) / 12_268_631).toBeLessThan(0.001);
  });

  it('follows the bearing and an off-equator centre', () => {
    const cases: [number, number, number, number, number][] = [
      [30, 45, 3, 50, 90],
      [170, -20, 1.8, 70, -135],
      [-75, 60, 4, 30, 200],
    ];
    for (const [lng, lat, zoom, pitch, bearing] of cases) {
      const map = { getCenter: () => ({ lng, lat }), getZoom: () => zoom, getPitch: () => pitch, getBearing: () => bearing, getCanvas: () => ({ clientHeight: 900 }) };
      const c = cameraFromMap(map);
      const want = ecefCamera(lng, lat, zoom, pitch, bearing, 900);
      expect(c.lat).toBeCloseTo(want.lat, 4);
      expect(((c.lng - want.lng + 540) % 360) - 180).toBeCloseTo(0, 4);
      expect(c.altitude / want.altitude).toBeCloseTo(1, 6);
    }
  });

  it('equals the centre fallback at pitch 0', () => {
    const map = { getCenter: () => ({ lng: 10, lat: 20 }), getZoom: () => 3, getPitch: () => 0, getBearing: () => 45, getCanvas: () => ({ clientHeight: 800 }) };
    expect(cameraFromMap(map)).toEqual({ lng: 10, lat: 20, altitude: altitudeForZoom(20, 3, 800) });
  });
});
