// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import type { Layer } from '@deck.gl/core';
import { useDeckLayerStore, useMapInstanceStore } from '@/lib/layer-host';
import { useUiStore } from '@/lib/store';
import { greatCircle } from '../lib/geometry';
import RouteLayer from './RouteLayer';

const gc = greatCircle([-0.461941, 51.4706], [-73.7781, 40.6413]);
const end = (ident: string, iata: string, lng: number, lat: number) => ({ ident, icao: ident, iata, name: ident, lat, lng, tz: null, municipality: null, isoCountry: 'GB' });
// Minimal plan/flight bodies (shape per RoutePlanResponse / FlightDetailResponse) for the map layer.
const planBody = { origin: end('EGLL', 'LHR', -0.461941, 51.4706), destination: end('KJFK', 'JFK', -73.7781, 40.6413), greatCircle: gc, diversionAirports: [], pathLabels: ['GREAT-CIRCLE ESTIMATE'] };
const liveBody = { from: 'LHR', to: 'JFK', aircraft: [], snapshotAt: null, providers: {}, timestamp: '2026-09-30T20:00:00Z' };
const flightBody = {
  ident: 'BAW117',
  resolved: { callsign: 'BAW117', hex: null, iataFlight: null, registration: null },
  origin: end('EGLL', 'LHR', -0.461941, 51.4706),
  destination: end('KJFK', 'JFK', -73.7781, 40.6413),
  plannedArc: gc.points,
  flownTrack: [],
  remainingLeg: [],
  position: null,
};

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(createElement(QueryClientProvider, { client }, createElement(RouteLayer)));
}

describe('RouteLayer', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (u: string) => {
        const body = u.startsWith('/api/route/plan') ? planBody : u.startsWith('/api/route/live') ? liveBody : flightBody;
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
    const handlers = new Map<string, () => void>();
    useMapInstanceStore.setState({
      map: { getCenter: () => ({ lng: -30, lat: 50 }), on: (e: string, f: () => void) => handlers.set(e, f), off: (e: string) => handlers.delete(e) } as never,
      projection: 'globe',
    });
    useUiStore.setState({ openPanel: null, plannedRoute: null, flightIdent: null, flyTo: null });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('?route= restores the PATHS panel, draws the great circle and frames it', async () => {
    useUiStore.setState({ plannedRoute: { from: 'LHR', to: 'JFK' } });
    await act(async () => {
      mount();
    });
    expect(useUiStore.getState().openPanel).toBe('paths');
    await waitFor(() => expect(useDeckLayerStore.getState().entries['flight-paths']).toBeDefined());
    const layers = useDeckLayerStore.getState().entries['flight-paths']!.layers as Layer[];
    expect(layers.map((l) => l.id)).toContain('route-planned-arc');
    expect(useUiStore.getState().flyTo).toMatchObject({ lng: gc.midpoint[0], lat: gc.midpoint[1] });
  });

  it('?flight= draws the planned arc of the tracked flight', async () => {
    useUiStore.setState({ flightIdent: 'BAW117' });
    await act(async () => {
      mount();
    });
    await waitFor(() => expect(useDeckLayerStore.getState().entries['flight-paths']).toBeDefined());
    expect(useUiStore.getState().flyTo).toMatchObject({ lng: -0.461941, zoom: 4 });
  });
});
