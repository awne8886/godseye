// Phase 1 review A regression (R-A5). Property test: polygon membership == solar elevation.
import { describe, expect, it } from 'vitest';
import { darknessRegion, solarElevation } from '@/lib/solar';
import { pointInPolygon } from '@/lib/geo';

const DATES = {
  marchEquinox: Date.parse('2026-03-20T14:46:00Z'),
  juneSolstice: Date.parse('2026-06-21T08:24:00Z'),
  decSolsticeAntimeridian: Date.parse('2026-12-21T00:00:00Z'),
  septEquinoxMidnight: Date.parse('2026-09-23T00:05:00Z'),
  now: Date.parse('2026-09-30T17:30:00Z'),
};

describe('R-A7 terminator darkness regions match solarElevation everywhere', () => {
  for (const [name, at] of Object.entries(DATES)) {
    for (const elev of [0, -6, -12, -18]) {
      it(`${name} @ ${elev}°`, () => {
        const poly = darknessRegion(at, elev, 1);
        const wrong: string[] = [];
        for (let lat = -88.5; lat <= 88.5; lat += 3) {
          for (let lng = -178.5; lng <= 178.5; lng += 3) {
            const h = solarElevation([lng, lat], at);
            if (Math.abs(h - elev) < 1.5) continue; // skip the boundary band (1° tracing step)
            const dark = h < elev;
            if (pointInPolygon([lng, lat], poly) !== dark) wrong.push(`${lng},${lat} h=${h.toFixed(1)}`);
          }
        }
        expect(wrong.slice(0, 5), `${wrong.length} misclassified`).toEqual([]);
      });
    }
  }
});
