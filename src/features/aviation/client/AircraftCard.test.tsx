// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { MAX_WATCHED_FLIGHTS, useUiStore } from '@/lib/store';
import { useLayerStatusStore } from '@/lib/layer-host';
import type { FlightRecord } from '../adsb';
import AircraftCard, { flightRouteQuery } from './AircraftCard';

const NOW = Date.parse('2026-09-30T18:07:00Z');
const rec: FlightRecord = {
  id: '4cafc4', callsign: 'RYR19WT', registration: 'EI-GXI', typeCode: 'B738', bucket: 'commercial', isHelicopter: false, onGround: false,
  lat: 52.83451, lng: -6.64775, altFt: 19525, altGeomFt: 19575, gsKt: 367.3, trackDeg: 357.5, vrFpm: -1920, squawk: '7700', emergency: '7700',
  category: 'A3', nacP: 11, dbFlags: 0, seenAt: NOW / 1000 - 20, source: 'adsblol_tiles', posSource: 'adsb',
};

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client }, children);
}

describe('aircraft card', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    // Every lookup fails: the card must still show what the feed observed, honestly labelled.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    useLayerStatusStore.setState({ status: { flights: { state: 'live', count: 1, fetchedAt: null, observedAt: null, lastGoodAt: null } } });
    useUiStore.setState({ watchedFlights: [], openPanel: null });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows source, observed-at time, a freshness badge and the emergency', async () => {
    await act(async () => {
      render(wrap(createElement(AircraftCard, { selection: { kind: 'aircraft', id: rec.id, layer: 'flights', source: rec.source, observedAt: null, data: { ...rec }, lngLat: [rec.lng, rec.lat] } })));
    });
    const card = screen.getByTestId('aircraft-card');
    expect(card.textContent).toContain('RYR19WT');
    expect(card.textContent).toContain('adsb.lol (area sweep)');
    expect(card.textContent).toContain('18:06:40Z');
    expect(card.textContent).toContain('GENERAL EMERGENCY (7700)');
    expect(card.textContent).toContain('FL195');
    expect(screen.getByTestId('freshness-badge').textContent).toBe('LIVE');
  });

  it('marks an old observation stale rather than live', async () => {
    const old = { ...rec, seenAt: NOW / 1000 - 600 };
    await act(async () => {
      render(wrap(createElement(AircraftCard, { selection: { kind: 'aircraft', id: old.id, layer: 'flights', source: old.source, observedAt: null, data: { ...old }, lngLat: null } })));
    });
    expect(screen.getByTestId('freshness-badge').textContent).toBe('STALE');
    expect(screen.getByTestId('aircraft-card').textContent).toContain('POSITION FROZEN');
  });

  it('watches (opening Flight Watch) and unwatches', async () => {
    await act(async () => {
      render(wrap(createElement(AircraftCard, { selection: { kind: 'aircraft', id: rec.id, layer: 'flights', source: rec.source, observedAt: null, data: { ...rec }, lngLat: null } })));
    });
    const btn = screen.getByRole('button', { name: /watch/i });
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    await act(async () => fireEvent.click(btn));
    expect(useUiStore.getState().watchedFlights).toEqual(['4cafc4']);
    expect(useUiStore.getState().openPanel).toBe('flight-watch');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /unwatch/i })));
    expect(useUiStore.getState().watchedFlights).toEqual([]);
  });
});

describe('flight-route query key (MINOR-4)', () => {
  it('is stable across poll-to-poll position and speed changes', () => {
    const a = flightRouteQuery('RYR19WT', { lat: 52.83451, lng: -6.64775, gsKt: 367.3 });
    const b = flightRouteQuery('RYR19WT', { lat: 52.9, lng: -6.62, gsKt: 371 });
    expect(b.key).toEqual(a.key);
    expect(a.key).toEqual(['flight-route', 'RYR19WT', 53, -6.5, 350]);
    expect(a.url).toBe('/api/flight-route?callsign=RYR19WT&lat=53&lng=-6.5&speed=350');
  });

  it('changes once the aircraft moves to another 0.5° cell (the plausibility gate still gets a position)', () => {
    const a = flightRouteQuery('RYR19WT', { lat: 52.83, lng: -6.64, gsKt: 367 });
    const c = flightRouteQuery('RYR19WT', { lat: 53.4, lng: -6.64, gsKt: 367 });
    expect(c.key).not.toEqual(a.key);
    expect(c.url).toContain('lat=53.5');
  });

  it('keeps coordinates in range at the poles and the antimeridian; no position → callsign only', () => {
    expect(flightRouteQuery('ABC1', { lat: 89.9, lng: 179.9, gsKt: null }).url).toBe('/api/flight-route?callsign=ABC1&lat=90&lng=180');
    expect(flightRouteQuery('ABC1', { lat: -0.1, lng: -179.9, gsKt: 1990 }).url).toBe('/api/flight-route?callsign=ABC1&lat=0&lng=180&speed=2000');
    expect(flightRouteQuery('ABC1', { lat: -0.1, lng: 0.1, gsKt: 10 }).key).toEqual(['flight-route', 'ABC1', 0, 0, 0]);
    expect(flightRouteQuery('ABC1', null)).toEqual({ key: ['flight-route', 'ABC1', null, null, null], url: '/api/flight-route?callsign=ABC1' });
  });
});

describe('watch list', () => {
  it(`keeps at most ${MAX_WATCHED_FLIGHTS}, drops the oldest, ignores duplicates and bad ids`, () => {
    useUiStore.setState({ watchedFlights: [] });
    const { watchFlight } = useUiStore.getState();
    for (let i = 0; i < 8; i++) watchFlight(`a0000${i}`);
    watchFlight('A00007');
    watchFlight('not-a-hex');
    expect(useUiStore.getState().watchedFlights).toEqual(['a00002', 'a00003', 'a00004', 'a00005', 'a00006', 'a00007']);
  });
});
