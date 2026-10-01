import { describe, expect, it } from 'vitest';
import { pickLeg } from './route-lookup';

type A = Parameters<typeof pickLeg>[0][number];
const ap = (icao: string, lat: number, lng: number) => ({ icao, iata: null, name: icao, lat, lng }) as unknown as A;
const DFW = ap('KDFW', 32.9, -97.04);
const JFK = ap('KJFK', 40.64, -73.78);

describe('pickLeg', () => {
  // VRS lists AAL606 as KDFW-KJFK-KDFW: both legs share one corridor; the track decides.
  const roundTrip = [DFW, JFK, DFW];
  const midway: [number, number] = [-85.4, 36.8];

  it('picks JFK→DFW for an aircraft heading south-west', () => {
    expect(pickLeg(roundTrip, midway, 240).map((a) => a.icao)).toEqual(['KJFK', 'KDFW']);
  });

  it('picks DFW→JFK for an aircraft heading north-east', () => {
    expect(pickLeg(roundTrip, midway, 60).map((a) => a.icao)).toEqual(['KDFW', 'KJFK']);
  });

  it('falls back to the nearest leg without a track', () => {
    expect(pickLeg(roundTrip, midway).map((a) => a.icao)).toEqual(['KDFW', 'KJFK']);
  });
});
