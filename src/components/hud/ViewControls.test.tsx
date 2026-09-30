// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLayerStatusStore } from '@/lib/layer-host';
import { publishCursor, publishView } from '@/lib/map/cursor';
import { TERRAIN_STATUS_TEXT } from '@/lib/map/terrain';
import { DEFAULT_SETTINGS, useUiStore } from '@/lib/store';
import { LayerRow } from './LayerRows';
import ViewControls, { GEOCODE_DEBOUNCE_MS, Readout, terrainText } from './ViewControls';
import { getLayer } from '@/lib/layer-registry';
import { routeListed } from './hooks';

/** Health is never fetched in these tests (fetch stubbed/unstubbed per test; retries off). */
function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  useUiStore.setState({ basemap: 'dark', projection: 'globe', settings: { ...DEFAULT_SETTINGS, units: 'metric' } });
  useLayerStatusStore.setState({ status: {} });
  publishCursor(null);
  publishView(null);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('MAP | SAT and 3D | 2D', () => {
  it('switches the basemap and projection through the store', () => {
    render(<ViewControls />);
    const sat = screen.getByRole('button', { name: 'SAT' });
    expect(sat.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(sat);
    expect(useUiStore.getState().basemap).toBe('satellite');
    expect(sat.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'MAP' }));
    expect(useUiStore.getState().basemap).toBe('dark');
    fireEvent.click(screen.getByRole('button', { name: '2D' }));
    expect(useUiStore.getState().projection).toBe('mercator');
  });

  it('shows the terrain status line only while 3D terrain is on', () => {
    useUiStore.getState().setLayer('terrain_elevation', false);
    render(<ViewControls />);
    expect(screen.queryByText(TERRAIN_STATUS_TEXT.loading)).toBeNull();
    act(() => {
      useUiStore.getState().setLayer('terrain_elevation', true);
      useLayerStatusStore.getState().update('terrain_elevation', { state: 'loading' });
    });
    expect(screen.getByText(TERRAIN_STATUS_TEXT.loading)).toBeTruthy();
    act(() => useLayerStatusStore.getState().update('terrain_elevation', { state: 'offline' }));
    expect(screen.getByText(TERRAIN_STATUS_TEXT.error)).toBeTruthy();
    expect(terrainText('reference')).toBe(TERRAIN_STATUS_TEXT.ready);
    expect(terrainText('idle')).toBe(TERRAIN_STATUS_TEXT.idle);
  });
});

describe('zero-render readout (map-engine cursor feed)', () => {
  it('writes the scale bar from subscribeView in the chosen units', () => {
    render(<Readout units="metric" />);
    act(() => publishView({ lng: 0, lat: 51.5, zoom: 10 }));
    expect(screen.getByTestId('scale-bar').textContent).toBe('2 KM');
    cleanup();
    render(<Readout units="aviation" />);
    expect(screen.getByTestId('scale-bar').textContent).toMatch(/NM$/);
  });

  it('writes the cursor position and resolves the place after the 3 s debounce, cached per 0.1° cell', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ results: [{ label: 'London, GB' }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<Readout units="metric" />);
    act(() => publishCursor({ lng: -0.1278, lat: 51.5074, zoom: 5 }));
    const readout = screen.getByTestId('cursor-readout');
    expect(readout.textContent).toBe('51.507°N 0.128°W');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GEOCODE_DEBOUNCE_MS - 100);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/geo/reverse?lat=51.5&lng=-0.1', expect.anything());
    expect(readout.textContent).toContain('London, GB');
    // Same cell: served from cache, no new request.
    act(() => publishCursor({ lng: -0.12, lat: 51.51, zoom: 5 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GEOCODE_DEBOUNCE_MS + 100);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    act(() => publishCursor(null));
    expect(readout.textContent).toBe('');
  });

  it('keeps coordinates only when the geocoder does not answer', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));
    render(<Readout units="metric" />);
    act(() => publishCursor({ lng: 30.31, lat: 10.02, zoom: 5 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GEOCODE_DEBOUNCE_MS + 100);
    });
    expect(screen.getByTestId('cursor-readout').textContent).toBe('10.020°N 30.310°E');
  });
});

describe('routes from later builders are only called once /api/health lists them', () => {
  it('routeListed reads the health route list', () => {
    expect(routeListed(undefined, '/api/geo/reverse')).toBe(false);
    expect(routeListed({ routes: ['/api/ticker'] } as never, '/api/ticker')).toBe(true);
    expect(routeListed({ routes: ['/api/ticker'] } as never, '/api/geo/reverse')).toBe(false);
  });
  it('the readout never geocodes when the route is not deployed', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<Readout units="metric" geocode={false} />);
    act(() => publishCursor({ lng: 12.5, lat: 41.9, zoom: 5 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GEOCODE_DEBOUNCE_MS * 2);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('cursor-readout').textContent).toBe('41.900°N 12.500°E');
  });
});

describe('layer row attribution', () => {
  it('renders the feed attribution with safe links and keeps the label in the accessible name', () => {
    useUiStore.getState().setLayer('earthquakes', true);
    useLayerStatusStore.getState().update('earthquakes', {
      state: 'live',
      count: 42,
      attribution: [
        { text: 'USGS Earthquake Hazards Program', url: 'https://earthquake.usgs.gov/', licence: 'Public domain' },
        { text: 'Hostile', url: 'javascript:alert(1)' },
      ],
    });
    render(
      <ul>
        <LayerRow layer={getLayer('earthquakes')!} />
      </ul>,
    );
    const btn = screen.getByRole('button', { name: /Earthquakes/ });
    expect(btn.textContent).toMatch(/^Earthquakes.*42$/);
    expect(btn.getAttribute('aria-label')).toBeNull();
    const link = screen.getByRole('link', { name: /USGS Earthquake Hazards Program · Public domain/ });
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.getAttribute('href')).toBe('https://earthquake.usgs.gov/');
    expect(screen.queryByRole('link', { name: /Hostile/ })).toBeNull();
    expect(screen.getByText('Hostile')).toBeTruthy();
    const desc = document.getElementById(btn.getAttribute('aria-describedby')!);
    expect(desc?.textContent).toContain('USGS Earthquake Hazards Program');
  });

  it('names providers skipped for want of a key, only while the layer is on', () => {
    useUiStore.getState().setLayer('cctv', true);
    useLayerStatusStore.getState().update('cctv', {
      state: 'live',
      count: 10,
      providers: {
        caltrans: { ok: true, count: 10, ms: 200, age_s: 5 },
        tfl: { ok: false, count: 0, ms: 0, age_s: null, skipped: 'not-configured' },
      },
    });
    render(
      <ul>
        <LayerRow layer={getLayer('cctv')!} />
      </ul>,
    );
    expect(screen.getByTestId('needs-key-cctv').textContent).toBe('NEEDS KEY · TFL');
    cleanup();
    useUiStore.getState().setLayer('cctv', false);
    render(
      <ul>
        <LayerRow layer={getLayer('cctv')!} />
      </ul>,
    );
    expect(screen.queryByTestId('needs-key-cctv')).toBeNull();
  });

  it('shows how many drawn aircraft are older than 60 s', () => {
    useUiStore.getState().setLayer('flights', true);
    useLayerStatusStore.getState().update('flights', { state: 'live', count: 900, staleCount: 1234 });
    render(
      <ul>
        <LayerRow layer={getLayer('flights')!} />
      </ul>,
    );
    expect(screen.getByTestId('stale-flights').textContent).toBe('1,234 OLDER THAN 60 S');
    cleanup();
    useLayerStatusStore.getState().update('flights', { staleCount: 0 });
    render(
      <ul>
        <LayerRow layer={getLayer('flights')!} />
      </ul>,
    );
    expect(screen.queryByTestId('stale-flights')).toBeNull();
  });
});
