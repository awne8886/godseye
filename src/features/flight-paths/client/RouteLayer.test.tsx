// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import type { Layer } from '@deck.gl/core';
import { useDeckLayerStore, useMapInstanceStore } from '@/lib/layer-host';
import { useUiStore } from '@/lib/store';
import { greatCircle } from '../lib/geometry';
import { frameArea, globeProjector, mercatorProjector } from './framing';
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

type Handler = (e?: unknown) => void;
function fakeMap(opts: { styleLoaded?: boolean; center?: [number, number] } = {}) {
  const handlers = new Map<string, Set<Handler>>();
  const on = (e: string, f: Handler) => void (handlers.get(e) ?? handlers.set(e, new Set()).get(e)!).add(f);
  const container = document.createElement('div');
  const map = {
    style: { _loaded: opts.styleLoaded ?? true },
    getCenter: () => ({ lng: opts.center?.[0] ?? -30, lat: opts.center?.[1] ?? 50 }),
    getZoom: () => 2,
    getContainer: () => container,
    isMoving: () => false,
    project: ([lng, lat]: [number, number]) => ({ x: lng, y: lat }),
    on,
    once: (e: string, f: Handler) => {
      const w: Handler = (x) => {
        handlers.get(e)?.delete(w);
        f(x);
      };
      on(e, w);
    },
    off: (e: string, f: Handler) => void handlers.get(e)?.delete(f),
    fitBounds: vi.fn(),
    easeTo: vi.fn(),
    fire: (e: string, x?: unknown) => [...(handlers.get(e) ?? [])].forEach((f) => f(x)),
  };
  return map;
}

describe('RouteLayer', () => {
  let map: ReturnType<typeof fakeMap>;
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (u: string) => {
        const body = u.startsWith('/api/route/plan') ? planBody : u.startsWith('/api/route/live') ? liveBody : flightBody;
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
    map = fakeMap();
    useMapInstanceStore.setState({ map: map as never, projection: 'globe', ready: true });
    useUiStore.setState({ openPanel: null, plannedRoute: null, flightIdent: null, flyTo: null });
    useDeckLayerStore.setState({ entries: {} });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('?route= restores the PATHS panel, draws the great circle and fits it padded by the HUD chrome and the panel (mercator)', async () => {
    useMapInstanceStore.setState({ projection: 'mercator' });
    useUiStore.setState({ plannedRoute: { from: 'LHR', to: 'JFK' } });
    await act(async () => {
      mount();
    });
    expect(useUiStore.getState().openPanel).toBe('paths');
    await waitFor(() => expect(useDeckLayerStore.getState().entries['flight-paths']).toBeDefined());
    const layers = useDeckLayerStore.getState().entries['flight-paths']!.layers as Layer[];
    expect(layers.map((l) => l.id)).toContain('route-planned-arc');
    // Mercator is solved like the globe (round 4 m2): a north-up, pitch-0 camera whose padding puts
    // the centre at the solved anchor (fitBounds kept the intro pitch and ignored the labels).
    await waitFor(() => expect(map.easeTo).toHaveBeenCalledTimes(1));
    expect(map.fitBounds).not.toHaveBeenCalled();
    const [opts] = map.easeTo.mock.calls[0]! as [{ center: [number, number]; zoom: number; pitch: number; bearing: number; padding: Record<'top' | 'right' | 'bottom' | 'left', number> }];
    expect(opts.pitch).toBe(0);
    expect(opts.bearing).toBe(0);
    // Header row + margin on top, status bar + margin below, the 48 px left rail + margin (R2-M4),
    // the docked PATHS panel on the right: both ends land inside that box.
    const area = frameArea({ width: window.innerWidth, height: window.innerHeight }, { side: 'right', size: 360 + 64 });
    expect(area).toMatchObject({ top: 104, left: 88, bottom: window.innerHeight - 68 });
    const anchor = [(opts.padding.left + window.innerWidth - opts.padding.right) / 2, (opts.padding.top + window.innerHeight - opts.padding.bottom) / 2];
    const project = mercatorProjector(opts.center, opts.zoom);
    for (const p of [planBody.origin, planBody.destination]) {
      const [x, y] = project([p.lng, p.lat])!;
      expect(anchor[0]! + x).toBeGreaterThanOrEqual(area.left);
      expect(anchor[0]! + x).toBeLessThanOrEqual(area.right);
      expect(anchor[1]! + y).toBeGreaterThanOrEqual(area.top);
      expect(anchor[1]! + y).toBeLessThanOrEqual(area.bottom);
    }
    // A rebuilt map (new instance) is framed again.
    const next = fakeMap({ center: [0, 0] });
    await act(async () => {
      useMapInstanceStore.setState({ map: next as never });
    });
    await waitFor(() => expect(next.easeTo).toHaveBeenCalledTimes(1));
  });

  it('on the globe a route is framed by its arc through the perspective projection, not a lng/lat box', async () => {
    useUiStore.setState({ plannedRoute: { from: 'LHR', to: 'JFK' } });
    await act(async () => {
      mount();
    });
    await waitFor(() => expect(map.easeTo).toHaveBeenCalledTimes(1));
    expect(map.fitBounds).not.toHaveBeenCalled();
    const [opts] = map.easeTo.mock.calls[0]! as [{ center: [number, number]; zoom: number; padding: Record<'top' | 'right' | 'bottom' | 'left', number> }];
    // Centred over the North Atlantic, on the arc's side of both ends.
    expect(opts.center[1]).toBeGreaterThan(40);
    expect(opts.center[0]).toBeLessThan(-10);
    expect(opts.center[0]).toBeGreaterThan(-70);
    expect(opts.zoom).toBeGreaterThan(0.5);
    // Every arc vertex lands left of the docked panel and inside the HUD chrome.
    const area = frameArea({ width: window.innerWidth, height: window.innerHeight }, { side: 'right', size: 360 + 64 });
    const anchor = [(opts.padding.left + window.innerWidth - opts.padding.right) / 2, (opts.padding.top + window.innerHeight - opts.padding.bottom) / 2];
    const project = globeProjector(opts.center, opts.zoom, window.innerHeight);
    for (const p of gc.points) {
      const xy = project(p as [number, number])!;
      expect(xy).not.toBeNull();
      expect(anchor[0]! + xy[0]).toBeLessThanOrEqual(area.right + 1);
      expect(anchor[0]! + xy[0]).toBeGreaterThanOrEqual(area.left - 1);
    }
  });

  it('the globe camera never asks for less than the map minimum zoom (round 3 M2)', async () => {
    const m = Object.assign(fakeMap(), { getMinZoom: () => 1.2 });
    useMapInstanceStore.setState({ map: m as never });
    useUiStore.setState({ plannedRoute: { from: 'LHR', to: 'JFK' } });
    await act(async () => {
      mount();
    });
    await waitFor(() => expect(m.easeTo).toHaveBeenCalledTimes(1));
    const [opts] = m.easeTo.mock.calls[0]! as [{ zoom: number; center: [number, number] }];
    // MapLibre's globe minimum zoom is latitude-adjusted (the globe keeps its minimum size).
    expect(opts.zoom).toBeGreaterThanOrEqual(1.2 + Math.log2(Math.cos((opts.center[1] * Math.PI) / 180)));
    await waitFor(() => expect(document.querySelector('[data-testid="flight-paths-status"]')?.getAttribute('data-fit')).toBe('full'));
  });

  it('a route restored after mount still opens PATHS (no first-render latch)', async () => {
    await act(async () => {
      mount();
    });
    expect(useUiStore.getState().openPanel).toBeNull();
    await act(async () => {
      useUiStore.setState({ plannedRoute: { from: 'LHR', to: 'JFK' } });
    });
    expect(useUiStore.getState().openPanel).toBe('paths');
  });

  it('frames at style.load when the style is not parsed yet, and once more at the first idle', async () => {
    map = fakeMap({ styleLoaded: false });
    useMapInstanceStore.setState({ map: map as never, ready: false });
    useUiStore.setState({ plannedRoute: { from: 'LHR', to: 'JFK' } });
    await act(async () => {
      mount();
    });
    await waitFor(() => expect(useDeckLayerStore.getState().entries['flight-paths']).toBeDefined());
    expect(map.easeTo).not.toHaveBeenCalled();
    await act(async () => map.fire('style.load'));
    expect(map.easeTo).toHaveBeenCalledTimes(1);
    await act(async () => useMapInstanceStore.setState({ ready: true }));
    expect(map.easeTo).toHaveBeenCalledTimes(2);
  });

  it('a viewer drag cancels the re-frame at idle', async () => {
    useMapInstanceStore.setState({ ready: false });
    useUiStore.setState({ plannedRoute: { from: 'LHR', to: 'JFK' } });
    await act(async () => {
      mount();
    });
    await waitFor(() => expect(map.easeTo).toHaveBeenCalledTimes(1));
    await act(async () => map.fire('movestart', { originalEvent: {} }));
    await act(async () => useMapInstanceStore.setState({ ready: true }));
    expect(map.easeTo).toHaveBeenCalledTimes(1);
  });

  it('?flight= draws the planned arc of the tracked flight and frames it', async () => {
    useUiStore.setState({ flightIdent: 'BAW117' });
    await act(async () => {
      mount();
    });
    await waitFor(() => expect(useDeckLayerStore.getState().entries['flight-paths']).toBeDefined());
    expect(useUiStore.getState().openPanel).toBe('paths');
    await waitFor(() => expect(map.easeTo).toHaveBeenCalled());
  });
});
