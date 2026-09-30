import { describe, expect, it } from 'vitest';
import { cameraTag, CCTV_REGIONS, isRegion, providerIdOf, regionsForPoint, stillPath } from './shared';

describe('surveillance shared helpers', () => {
  it('selects regions by point, falling back to the nearest box', () => {
    expect(regionsForPoint(34.05, -118.24)).toEqual(['us-west']);
    expect(regionsForPoint(51.5, -0.12)).toEqual(['uk', 'europe']); // overlapping boxes: both served
    expect(regionsForPoint(1.35, 103.82)).toEqual(['asia']);
    expect(regionsForPoint(-36.85, 174.76)).toEqual(['oceania']);
    expect(regionsForPoint(-33.9, 18.4)).toHaveLength(1); // Cape Town: nearest box only
    expect(CCTV_REGIONS.every(isRegion)).toBe(true);
    expect(isRegion('mars')).toBe(false);
  });

  it('ids, tags and still paths', () => {
    expect(providerIdOf('txdot-AUS-FM-734 @ US-290 EB')).toBe('txdot');
    expect(cameraTag(34.0837, -118.2215)).toBe('CAM-3408N-11822W');
    expect(cameraTag(-1.5, 3)).toBe('CAM-0150S-00300E');
    expect(stillPath({ id: 'txdot-AUS-X 1', providerId: 'txdot' })).toBe('/api/cctv/texas/snapshot?id=txdot-AUS-X%201');
    expect(stillPath({ id: 'hktd-H429F', providerId: 'hktd' })).toBe('/api/cctv/proxy?id=hktd-H429F');
  });
});
