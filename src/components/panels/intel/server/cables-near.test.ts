import { describe, expect, it } from 'vitest';
import { cablesNear, lineDistanceKm } from '@/components/panels/intel/server/nearby';

// TeleGeography "Sta'O'Nuk" (US Pacific NW -> Japan), as served by /api/cables on 2026-10-01.
const staonuk = { type: 'MultiLineString', coordinates: [
  [[-124.159, 47.009], [-124.799, 47.009], [-125.844, 47.189], [-131.481, 49.181], [-138.606, 49.532], [-151.2, 50.167], [-180, 50.167]],
  [[180, 50.167], [172.8, 50.167], [160.2, 47.197], [149.377, 40.325], [142.13, 37.058], [141.804, 36.685], [141.11, 36.433], [140.612, 36.383]],
] };

describe('R3 r2: dossier cables near a point', () => {
  it('a North Pacific cable is not within 150 km of Kyiv', () => {
    const d = lineDistanceKm(50.45, 30.52, staonuk)!;
    expect(d).toBeGreaterThan(5000); // FAILS today: 67.8 km
    const r = cablesNear({ cables: [{ id: 'staonuk', name: 'Sta’O’Nuk', geometry: staonuk }], landingPoints: [] }, 50.45, 30.52, 150);
    expect(r?.count).toBe(0); // FAILS today: 1
  });
});
