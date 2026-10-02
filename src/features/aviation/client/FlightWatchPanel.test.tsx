// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { useUiStore } from '@/lib/store';
import FlightWatchPanel, { watchRouteLine } from './FlightWatchPanel';
import { useAviationPrefs } from './useFlights';

function renderPanel(onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(createElement(QueryClientProvider, { client }, createElement(FlightWatchPanel, { onClose })));
}

describe('Flight Watch panel', () => {
  beforeEach(() => {
    // Upstreams unavailable: the panel must say so rather than invent telemetry.
    const meta = { feed: 'flights', kind: 'live', state: 'offline', fetchedAt: null, observedAt: null, lastGoodAt: null, stale: true, ttlSeconds: 15, attribution: [] };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'source_offline', meta, providers: {} }), { status: 503 })));
    useAviationPrefs.setState({ colorMode: 'bucket' });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows STANDBY and how to add aircraft when nothing is watched', async () => {
    useUiStore.setState({ watchedFlights: [] });
    await act(async () => {
      renderPanel();
    });
    expect(screen.getByTestId('flight-watch').textContent).toContain('STANDBY');
    expect(screen.getByText(/press WATCH/i)).toBeTruthy();
  });

  it('lists watched aircraft honestly when the feed has no data for them, and unwatches', async () => {
    useUiStore.setState({ watchedFlights: ['4cafc4', 'a00001'] });
    await act(async () => {
      renderPanel();
    });
    const panel = screen.getByTestId('flight-watch');
    expect(panel.textContent).toContain('4CAFC4');
    // The 503 resolves asynchronously; under a loaded test run it can land after the first tick.
    await waitFor(() => expect(panel.textContent).toContain('SOURCE OFFLINE'));
    expect(panel.textContent).toContain('FEED OFFLINE');
    expect(panel.textContent).not.toContain('NO LONGER IN THE LIVE FEED'); // an outage is not a departure
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stop watching 4CAFC4' })));
    expect(useUiStore.getState().watchedFlights).toEqual(['a00001']);
  });

  it('switches the aircraft colour mode (aria-pressed) and closes', async () => {
    useUiStore.setState({ watchedFlights: [] });
    const onClose = vi.fn();
    await act(async () => {
      renderPanel(onClose);
    });
    const alt = screen.getByRole('button', { name: 'ALTITUDE' });
    expect(alt.getAttribute('aria-pressed')).toBe('false');
    await act(async () => fireEvent.click(alt));
    expect(useAviationPrefs.getState().colorMode).toBe('altitude');
    expect(screen.getByRole('button', { name: 'ALTITUDE' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Close Flight Watch' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('Flight Watch route line (same answer as the aircraft card)', () => {
  const base = { callsign: 'SWA1241', found: true, origin: null, destination: null, basis: null, status: 'unknown', progress: null, distanceKm: null, source: 'vrs', providers: {}, timestamp: '2026-10-01T13:20:00.000Z' } as const;
  const LAS = { icao: 'KLAS', iata: 'LAS', name: 'McCarran International Airport', city: 'Las Vegas', country: 'US', lat: 36.080101, lng: -115.152 };
  const DCA = { icao: 'KDCA', iata: 'DCA', name: 'Ronald Reagan Washington National Airport', city: 'Washington', country: 'US', lat: 38.8521, lng: -77.037697 };

  it('never names a leg the card withholds', () => {
    expect(watchRouteLine({ ...base, directionConflict: true, routeCheck: 'observed departure DCA contradicts standing data LAS→DCA' }, true, false, null)).toBe('ROUTE UNCONFIRMED — OBSERVED TRACK DISAGREES');
    expect(watchRouteLine({ ...base, routeCheck: 'round trip ATL→BNA→ATL: the leg being flown is unknown without an observed position' }, true, false, null)).toBe('LEG NOT DETERMINED');
  });

  it('shows the leg with the exact-position progress, and how it was established', () => {
    const leg = { ...base, origin: LAS, destination: DCA, basis: 'corridor' as const, status: 'airborne' as const, progress: 0.5, distanceKm: 3354 };
    expect(watchRouteLine(leg, true, false, 0.93)).toBe('LAS → DCA · 93%');
    expect(watchRouteLine({ ...leg, basis: 'observed', progress: null }, true, false, null)).toBe('LAS → DCA · NOT ON COURSE');
    expect(watchRouteLine({ ...leg, basis: 'observed', onCorridor: false, progress: null }, true, false, null)).toBe('LAS → DCA · NOT ON COURSE');
    expect(watchRouteLine({ ...leg, basis: 'observed', onCorridor: true }, true, false, 0.5)).toBe('LAS → DCA · 50% · OBSERVED DEPARTURE');
    expect(watchRouteLine({ ...leg, origin: DCA, destination: LAS, basis: 'observed', reversed: true }, true, false, 0.1)).toBe('DCA → LAS · 10% · REVERSE OF LISTED (OBSERVED)');
  });

  it('says what is missing otherwise', () => {
    expect(watchRouteLine(undefined, false, false, null)).toBe('NO CALLSIGN');
    expect(watchRouteLine(undefined, true, true, null)).toBe('RESOLVING ROUTE…');
    expect(watchRouteLine({ ...base, found: false }, true, false, null)).toBe('NO SCHEDULED ROUTE');
    expect(watchRouteLine({ ...base, found: false, implausible: true }, true, false, null)).toBe('LISTED ROUTE DOES NOT MATCH POSITION');
  });
});
