// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { Profile, profilePoints, typicalClimb } from './Profile';
import { FlightView } from './PathsPanel';
import type { Flight } from './api';

// Points from the recorded adsb.lol trace shape (aviation fixture trace-full-4cafc4, 2026-09-30).
const track: Flight['flownTrack'] = [
  { t: '2026-09-30T18:00:00Z', lat: 41.2913, lng: 2.0693, altFt: null, onGround: true, gsKt: 17.5, trackDeg: 67.5 },
  { t: '2026-09-30T18:10:00Z', lat: 41.5, lng: 2.5, altFt: 15000, onGround: false, gsKt: 320, trackDeg: 40 },
  { t: '2026-09-30T18:30:00Z', lat: 43, lng: 3.5, altFt: 37000, onGround: false, gsKt: 460, trackDeg: 20 },
];

describe('Profile', () => {
  afterEach(cleanup);

  it('times from the first point; ground rows are 0 ft', () => {
    expect(profilePoints(track).map((p) => [p.tMin, p.altFt])).toEqual([
      [0, 0],
      [10, 15000],
      [30, 37000],
    ]);
    expect(profilePoints([])).toEqual([]);
  });

  it('typical model climbs 2,000 ft/min to FL350 then cruises', () => {
    expect(typicalClimb(10)).toEqual([
      [0, 0],
      [10, 20000],
    ]);
    expect(typicalClimb(60)).toEqual([
      [0, 0],
      [17.5, 35000],
      [60, 35000],
    ]);
  });

  it('renders observed lines and labels the model; nothing for < 2 points', () => {
    const { container } = render(createElement(Profile, { track }));
    expect(container.querySelectorAll('polyline')).toHaveLength(3);
    expect(screen.getByText(/typical-profile model/)).toBeTruthy();
    cleanup();
    const empty = render(createElement(Profile, { track: track.slice(0, 1) }));
    expect(empty.container.innerHTML).toBe('');
  });

  it('FlightView shows the profile, route and a withheld-route note', () => {
    const base = {
      ident: 'BAW117',
      resolved: { callsign: 'BAW117', iataFlight: 'BA117', hex: '4ca1fa', registration: 'EI-DDH' },
      status: 'airborne',
      origin: null,
      destination: null,
      plannedArc: [],
      flownTrack: track,
      remainingLeg: [],
      position: { lat: 43, lng: 3.5, altFt: 37000, gsKt: 460, trackDeg: 20, observedAt: '2026-09-30T18:30:00Z' },
      progress: 0.4,
      eta: null,
      etaLocal: null,
      identity: null,
      weather: { origin: null, destination: null },
      links: [],
      sources: [{ name: 'corroboration', ok: false, detail: 'observed departure is not LHR; route withheld' }],
      providers: { flights: { ok: false, count: 0, ms: 0, age_s: null, error: 'no_flights_snapshot' } },
      timestamp: '2026-09-30T18:31:00Z',
    } as unknown as Flight;
    render(createElement(FlightView, { flight: base }));
    expect(screen.getByText('No corroborated route for this flight.')).toBeTruthy();
    expect(screen.getByRole('img', { name: /Altitude and ground-speed profile/ })).toBeTruthy();
    expect(screen.getByText(/route withheld/)).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Flight progress' })).toBeTruthy();
  });
});
