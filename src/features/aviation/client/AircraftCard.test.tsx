// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { MAX_WATCHED_FLIGHTS, useUiStore } from '@/lib/store';
import { useLayerStatusStore } from '@/lib/layer-host';
import type { FlightRecord } from '../adsb';
import AircraftCard from './AircraftCard';

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
