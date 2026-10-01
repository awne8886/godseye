import { describe, expect, it } from 'vitest';
import { mapOpenSkyStates } from './providers';

// The documented /api/states/all row shape (docs/reference/25 §0): [icao24, callsign, origin_country,
// time_position, last_contact, lon, lat, baro_altitude m, on_ground, velocity m/s, true_track,
// vertical_rate m/s, sensors, geo_altitude m, squawk, spi, position_source, category]. A test
// input for the unit mapping only (OpenSky is licence-gated and was not probed).
const row = (timePosition: number) => ['4ca1fa', 'RYR19WT ', 'Ireland', timePosition, timePosition, -6.64775, 52.83451, 5951.2, false, 188.9, 357.5, -9.75, null, 5966.5, '1045', false, 0, 4];

describe('OpenSky state vectors', () => {
  it('maps units and never dates a position after its receipt (R2 round 5 MINOR-2)', () => {
    const received = 1_790_791_610_751;
    const { records } = mapOpenSkyStates([row(1_790_791_612), row(1_790_791_600)], received);
    expect(records[0]).toMatchObject({ id: '4ca1fa', callsign: 'RYR19WT', altFt: 19525, gsKt: 367.2, trackDeg: 357.5, source: 'opensky', posSource: 'adsb' });
    expect(records[0]!.seenAt).toBe(Math.floor(received / 1000)); // 2 s "in the future" → clamped to receipt
    expect(records[1]!.seenAt).toBe(1_790_791_600);
    for (const r of records) expect(r.seenAt * 1000).toBeLessThanOrEqual(received);
  });
});
