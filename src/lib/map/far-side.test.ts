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
});
