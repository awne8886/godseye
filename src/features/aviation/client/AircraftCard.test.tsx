// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { MAX_WATCHED_FLIGHTS, useUiStore } from '@/lib/store';
import { useLayerStatusStore } from '@/lib/layer-host';
import type { FlightRecord } from '../adsb';
import AircraftCard, { cardProgress, flightRouteQuery } from './AircraftCard';

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

describe('route section honesty (R2 round 4 BLOCKING-1, MINOR-6)', () => {
  const route = (p: Record<string, unknown>) => ({
    callsign: 'RYR19WT', found: true, origin: null, destination: null, basis: null, status: 'unknown', progress: null, distanceKm: null, source: 'vrs',
    providers: { vrs: { ok: true, count: 1, ms: 5, age_s: 0 } }, timestamp: '2026-09-30T18:07:00.000Z', ...p,
  });
  const EIDW = { icao: 'EIDW', iata: 'DUB', name: 'Dublin', city: 'Dublin', country: 'IE', lat: 53.4213, lng: -6.27 };
  const EGPH = { icao: 'EGPH', iata: 'EDI', name: 'Edinburgh', city: 'Edinburgh', country: 'GB', lat: 55.95, lng: -3.3725 };
  const renderWith = async (body: unknown) => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).startsWith('/api/flight-route') ? new Response(JSON.stringify(body), { status: 200 }) : new Response('{}', { status: 503 }))));
    await act(async () => {
      render(wrap(createElement(AircraftCard, { selection: { kind: 'aircraft', id: rec.id, layer: 'flights', source: rec.source, observedAt: null, data: { ...rec }, lngLat: null } })));
    });
    await act(async () => {});
  };
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    useLayerStatusStore.setState({ status: { flights: { state: 'live', count: 1, fetchedAt: null, observedAt: null, lastGoodAt: null } } });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('names no leg, destination or progress when the observed track contradicts the listed route', async () => {
    await renderWith(route({ directionConflict: true, routeCheck: 'airborne inside the corridor but heading toward DUB, opposite to standing data DUB→EDI; departure not observed — route not confirmed' }));
    expect((await screen.findByTestId('route-unconfirmed', {}, { timeout: 5_000 })).textContent).toContain('ROUTE UNCONFIRMED — OBSERVED TRACK DISAGREES');
    expect(screen.getByTestId('route-unconfirmed').textContent).toContain('departure not observed');
    expect(screen.queryByTestId('route-leg')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('labels a corroborated reverse leg as observed', async () => {
    await renderWith(route({ origin: EGPH, destination: EIDW, basis: 'observed', status: 'airborne', progress: 0.5, distanceKm: 350, reversed: true, routeCheck: 'observed departure EDI and course toward DUB' }));
    expect((await screen.findByTestId('route-leg', {}, { timeout: 5_000 })).textContent).toMatch(/EDI.*DUB/);
    expect(screen.getByTestId('aircraft-card').textContent).toContain('OBSERVED DEPARTURE · REVERSE OF LISTED ROUTE');
  });

  it('computes the bar from the exact observed position, not the cached answer', () => {
    const r = route({ origin: EIDW, destination: EGPH, basis: 'corridor', status: 'airborne', progress: 0.1, distanceKm: 350 }) as never;
    const a = cardProgress(r, { lat: 54.2, lng: -5.2, gsKt: 400, onGround: false });
    const b = cardProgress(r, { lat: 54.6, lng: -4.6, gsKt: 400, onGround: false });
    expect(a).not.toBeNull();
    expect(b!).toBeGreaterThan(a!);
    expect(a).not.toBe(0.1);
    // Off the corridor now, on the ground, or no corridor answer: no bar.
    expect(cardProgress(r, { lat: 40, lng: 20, gsKt: 400, onGround: false })).toBeNull();
    expect(cardProgress(r, { lat: 54.2, lng: -5.2, gsKt: 0, onGround: true })).toBeNull();
    expect(cardProgress(route({ origin: EIDW, destination: EGPH, basis: 'schedule', progress: null }) as never, { lat: 54.2, lng: -5.2, gsKt: 400, onGround: false })).toBeNull();
  });
});

describe('flight-route query key (MINOR-4)', () => {
  it('sends the hex for exact-position and flown-track corroboration (keyed per aircraft)', () => {
    const q = flightRouteQuery('RYR19WT', { lat: 52.83451, lng: -6.64775, gsKt: 367.3, trackDeg: 357.5 }, '4cafc4');
    expect(q.url).toBe('/api/flight-route?callsign=RYR19WT&icao24=4cafc4&lat=53&lng=-6.5&speed=350&track=0');
    expect(q.key).toEqual(['flight-route', 'RYR19WT', 53, -6.5, 350, 0, '4cafc4']);
    expect(flightRouteQuery('RYR19WT', null, 'not-hex').url).toBe('/api/flight-route?callsign=RYR19WT');
  });

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
