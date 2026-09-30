// Phase 1 review A regressions (R-A6 local times, R-A7 callsigns, R-A8 ~hex, IsoTime behaviour).
import { describe, expect, it } from 'vitest';
import { AirportDetailResponse, Aircraft, IsoTime, LiveRouteAircraft, RoutePlanResponse } from '@/lib/schemas';
import { useUiStore } from '@/lib/store';

describe('R-A6 local-time fields have no format (timezone ambiguity)', () => {
  it('etaLocal / localNow / localTime reject offset-less wall-clock strings', () => {
    const shape = LiveRouteAircraft.shape.etaLocal;
    // Parsed by the browser as *browser-local* time -> wrong instant for any viewer not in the dest tz.
    expect(shape.safeParse('2026-09-30T18:29:00').success).toBe(false);
    expect(shape.safeParse('6:29 PM').success).toBe(false);
    expect(shape.safeParse('2026-09-30T18:29:00+01:00').success).toBe(true);
    expect(shape.safeParse('2026-09-30T17:29:00Z').success).toBe(true);
    expect(AirportDetailResponse.shape.localTime.safeParse('tomorrow-ish').success).toBe(false);
    expect(RoutePlanResponse.shape.timezones.shape.origin.shape.localNow.safeParse('garbage').success).toBe(false);
  });
});

describe('R-A8 callsign padding and ~hex watch', () => {
  it('Aircraft.callsign rejects the raw adsb.lol padded value (probe: "CFE37E  ")', () => {
    const base = {
      id: '4ca1fa', lat: 51.47, lng: -0.45, observedAt: '2026-09-30T17:27:56Z', source: 'adsblol', callsign: 'CFE37E  ',
      registration: null, typeCode: null, bucket: 'commercial', isHelicopter: false, onGround: false, altFt: 3000,
      altGeomFt: null, gsKt: 200, trackDeg: 90, vrFpm: 0, squawk: null, emergency: null, category: null, nacP: null,
      dbFlags: null, airlineCode: null,
    };
    expect(Aircraft.safeParse(base).success).toBe(false);
    expect(Aircraft.safeParse({ ...base, callsign: 'CFE37E' }).success).toBe(true);
  });

  it('watchFlight accepts every id Aircraft.id accepts (incl. ~ non-ICAO/TIS-B)', () => {
    expect(Aircraft.shape.id.safeParse('~a1b2c3').success).toBe(true);
    useUiStore.getState().watchFlight('~a1b2c3');
    expect(useUiStore.getState().watchedFlights).toContain('~a1b2c3');
  });
});

describe('IsoTime vs real producer output', () => {
  it('rejects the raw NOAA/GDACS/CelesTrak offset-less times so producers must normalise', () => {
    expect(IsoTime.safeParse('2026-09-23T00:00:00').success).toBe(false); // NOAA Kp time_tag
    expect(IsoTime.safeParse('2026-09-30T17:20:00.000Z').success).toBe(true); // AWC reportTime
    expect(IsoTime.safeParse('2026-09-30T03:25:12.177120Z').success).toBe(true); // CelesTrak EPOCH + Z
    expect(IsoTime.safeParse('2026-09-30T17:20:00+00:00').success).toBe(false); // explicit offset rejected
  });
});
