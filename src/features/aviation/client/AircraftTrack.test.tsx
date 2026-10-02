// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import type { Selection } from '@/lib/layer-host';
import type { TrackPoint } from '../trace';
import AircraftTrack, { profileOf, summariseTrack } from './AircraftTrack';

// Three samples of a recorded leg (adsb.lol trace of 77058f, 2026-10-02): take-off roll, climb, cruise.
const TRACK: TrackPoint[] = [
  { t: '2026-10-02T06:47:44.816Z', lat: -33.93592, lng: 151.1733, altFt: null, onGround: true, gsKt: 87, trackDeg: 168.8 },
  { t: '2026-10-02T07:00:00.000Z', lat: -33.2, lng: 150.4, altFt: null, onGround: false, gsKt: 400, trackDeg: 320 },
  { t: '2026-10-02T07:26:24.785Z', lat: -31.31965, lng: 148.58773, altFt: 32000, onGround: false, gsKt: 441.1, trackDeg: 325.2 },
];
const DETAIL = {
  hex: '77058f',
  identity: null,
  track: TRACK,
  trackSource: 'adsb_icao',
  meta: {},
  providers: { adsbdb: { ok: true, count: 1, ms: 473, age_s: 0 }, adsblol_trace: { ok: true, count: 3, ms: 882, age_s: 0 } },
};

const sel = (id: string): Selection => ({ kind: 'aircraft', id, layer: 'flights', source: 'adsblol_tiles', observedAt: null, data: {}, lngLat: null });
const wrap = (id: string) =>
  render(createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, createElement(AircraftTrack, { selection: sel(id) })));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('aircraft TRACK tab', () => {
  it('summarises only the observed samples', () => {
    const s = summariseTrack(TRACK)!;
    expect(s.points).toBe(3);
    expect(s.firstMs).toBe(Date.parse(TRACK[0]!.t));
    expect(s.lastMs).toBe(Date.parse(TRACK[2]!.t));
    expect(s.maxAltFt).toBe(32000);
    expect(s.distanceKm).toBeGreaterThan(300);
    expect(summariseTrack([])).toBeNull();
    // Ground = 0 ft (observed on the ground); airborne without altitude = gap.
    expect(profileOf(TRACK).map((p) => p.v)).toEqual([0, null, 32000]);
  });

  it('shows the flown track, altitude profile and latest observed positions from /api/aircraft', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(DETAIL), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    wrap('77058f');
    expect(await screen.findByTestId('aircraft-track')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/aircraft?icao24=77058f', expect.anything());
    expect(screen.getByText(/OBSERVED · CURRENT LEG · 3 POSITIONS/)).toBeTruthy();
    expect(screen.getByTestId('ground-track-plot')).toBeTruthy();
    expect(screen.getByTestId('profile-plot').getAttribute('aria-label')).toBe('ALT: 0 FT to 32,000 FT, 06:47:44Z to 07:26:24Z');
    // Newest first, each with its own observed time.
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]!.textContent).toContain('07:26:24Z');
    expect(rows[2]!.textContent).toContain('06:47:44Z');
  });

  it('says so instead of drawing anything when the trace is unavailable or there is none', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    wrap('77058f');
    expect(await screen.findByText('TRACE SOURCE OFFLINE · NO TRACK SHOWN')).toBeTruthy();
    expect(screen.queryByTestId('ground-track-plot')).toBeNull();
    cleanup();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...DETAIL, track: [], providers: { ...DETAIL.providers, adsblol_trace: { ok: false, count: 0, ms: 9, age_s: null, error: 'timeout' } } }), { status: 200 })));
    wrap('77058f');
    expect(await screen.findByText('TRACE SOURCE FAILED · NO TRACK SHOWN')).toBeTruthy();
    cleanup();
    wrap('~1a2b3c');
    expect(screen.getByText(/NO TRACE · NON-ICAO ADDRESS/)).toBeTruthy();
  });
});
