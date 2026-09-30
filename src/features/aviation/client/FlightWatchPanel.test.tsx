// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { useUiStore } from '@/lib/store';
import FlightWatchPanel from './FlightWatchPanel';
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
    expect(panel.textContent).toContain('SOURCE OFFLINE');
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
