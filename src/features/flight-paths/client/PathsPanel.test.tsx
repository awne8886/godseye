// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import type * as RateLimitModule from '@/lib/ratelimit';
import type * as HttpModule from '@/lib/http';
import { MemoryStore, clearL1, setStore } from '@/lib/cache';
import { useUiStore } from '@/lib/store';
import { newMode, upstreamBody } from '../__fixtures__/upstreams';
import { greatCircle } from '../lib/geometry';

// The panel's fetch() is served in-process by the real route handlers; their upstreams are the
// recorded fixtures (2026-09-30) through the mocked http layer. No network.
const mode = vi.hoisted(() => ({ current: null as unknown as ReturnType<typeof newMode>, flights: null as unknown }));

vi.mock('@/lib/ratelimit', async (orig) => {
  const actual = await orig<typeof RateLimitModule>();
  return { ...actual, providerBucket: () => ({ take: async () => undefined, tryTake: () => true }), rateLimit: async () => null };
});
vi.mock('@/lib/http', async (orig) => {
  const actual = await orig<typeof HttpModule>();
  return {
    ...actual,
    httpJson: vi.fn(async (u: string | URL) => {
      const url = String(u);
      const body = upstreamBody(url, mode.current);
      if (body === undefined) throw new actual.HttpError('HTTP 404', 'http', url, 404);
      return { data: structuredClone(body), status: 200, ok: true, notModified: false, headers: {}, body: Buffer.alloc(0), url, etag: null, lastModified: null, ms: 1, attempts: 1 };
    }),
  };
});
vi.mock('@/features/aviation/feeds', () => ({ flightsFeed: { get: async () => mode.flights } }));
vi.mock('@/components/hud/PanelChrome', () => ({ usePanelChip: () => undefined }));

const plan = (await import('@/app/api/route/plan/route')).GET;
const live = (await import('@/app/api/route/live/route')).GET;
const search = (await import('@/app/api/airports/search/route')).GET;
const flight = (await import('@/app/api/flight/[ident]/route')).GET;
const { default: PathsPanel } = await import('./PathsPanel');
const { fitState, obscuredFitText, partialFitText, setFitNotice } = await import('./fit');

async function serve(input: string | URL | Request): Promise<Response> {
  const url = new URL(String(input instanceof Request ? input.url : input), 'http://localhost');
  const req = new Request(url);
  if (url.pathname === '/api/route/plan') return plan(req, undefined);
  if (url.pathname === '/api/route/live') return live(req, undefined);
  if (url.pathname === '/api/airports/search') return search(req, undefined);
  if (url.pathname.startsWith('/api/flight/')) return flight(req, { params: Promise.resolve({ ident: url.pathname.split('/').pop()! }) });
  return new Response('{}', { status: 404 });
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(createElement(QueryClientProvider, { client }, createElement(PathsPanel, { onClose: vi.fn() })));
}

const mid = greatCircle([-0.461941, 51.4706], [-73.7781, 40.6413]).points[128]!;
const nowS = Math.round(Date.now() / 1000);
const meta = (ok: boolean) => ({
  feed: 'flights',
  kind: 'live',
  state: ok ? 'live' : 'offline',
  fetchedAt: ok ? new Date().toISOString() : null,
  observedAt: null,
  lastGoodAt: ok ? new Date().toISOString() : '2026-09-30T03:12:00Z',
  stale: !ok,
  ttlSeconds: 15,
  attribution: [],
});

describe('PATHS panel', () => {
  beforeEach(() => {
    clearL1();
    setStore(new MemoryStore());
    mode.current = newMode();
    mode.flights = {
      data: {
        records: [
          { id: '4ca1fa', callsign: 'BAW117', registration: 'EI-DDH', typeCode: 'B772', bucket: 'commercial', isHelicopter: false, onGround: false, lat: mid[1], lng: mid[0], altFt: 37000, altGeomFt: null, gsKt: 480, trackDeg: 268, vrFpm: 0, squawk: null, emergency: null, category: null, nacP: null, dbFlags: null, seenAt: nowS - 3, source: 'adsblol_tiles', posSource: 'adsb' },
        ],
      },
      meta: meta(true),
      providers: { adsblol_tiles: { ok: true, count: 1, ms: 5, age_s: 1 } },
    };
    vi.stubGlobal('fetch', vi.fn(serve));
    useUiStore.setState({ plannedRoute: null, flightIdent: null });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('empty state offers sample routes; LHR → JFK plots the honest labels and sections', async () => {
    await act(async () => {
      renderPanel();
    });
    expect(screen.getByText(/Plot a route between two airports/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'LHR → JFK' }));
    });
    expect(useUiStore.getState().plannedRoute).toEqual({ from: 'LHR', to: 'JFK' });
    await waitFor(() => expect(screen.getByText('LHR → JFK')).toBeTruthy(), { timeout: 30_000 });
    expect(screen.getByText('GREAT-CIRCLE ESTIMATE')).toBeTruthy();
    expect(screen.getByText('FILED · NOT AVAILABLE')).toBeTruthy();
    expect(screen.getByText('TYPICAL · NOT AVAILABLE')).toBeTruthy();
    expect(screen.getByText('BAW117')).toBeTruthy();
    expect(screen.getByText('KNOWN SERVICES')).toBeTruthy();
    expect(screen.getByText(/HISTORICAL AIRLINES \(2014\)/)).toBeTruthy();
    expect(screen.getByText(/DIVERSION AIRPORTS/)).toBeTruthy();
    expect(screen.getAllByText(/METAR EGLL/).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/Daylight:/)).toBeTruthy();
    // visual-qa M4: unavailable legend rows are full-contrast text with a dashed swatch, never dimmed.
    const legend = screen.getByRole('list', { name: 'Path types' });
    for (const li of Array.from(legend.querySelectorAll('li'))) expect((li as HTMLElement).style.opacity).toBe('');
    expect(legend.querySelectorAll('li[data-available="false"] .border-dashed').length).toBe(2);
    // Round 6 M1: the US airways drawn near JFK are disclosed as FAA reference data, dated by the FAA's Last-Modified.
    const airwaysRow = legend.querySelector('[data-testid="legend-airways"]');
    expect(airwaysRow?.textContent).toMatch(/AIRWAYS \(FAA, REFERENCE\)/);
    expect(airwaysRow?.textContent).toMatch(/FAA ADDS ATS_Route, data as of 2026-09-03\)\. Reference structure, not this flight's filed route\./);
    // visual-qa m3: km and nm on two lines, no dangling separator.
    expect(screen.getByText('5,540 KM')).toBeTruthy();
    expect(screen.getByText('2,991 NM')).toBeTruthy();
  }, 40_000); // first test loads the bundled airport/route indexes cold; slow on a loaded 4-vCPU box

  it('names the endpoints the framing could not keep clear of the map controls, and drops the line once they are clear (round 4 fix pass)', async () => {
    useUiStore.setState({ plannedRoute: { from: 'PER', to: 'LHR' } });
    await act(async () => {
      renderPanel();
    });
    expect(screen.queryByTestId('paths-fit-obscured')).toBeNull();
    await act(async () => setFitNotice({ key: 'route:YPPH-EGLL', fits: true, hidden: ['PER'] }));
    expect(screen.getByTestId('paths-fit-obscured').textContent).toBe(obscuredFitText(['PER']));
    expect(obscuredFitText(['PER'])).toMatch(/the PER endpoint could not be kept clear of the map controls — drag or zoom the map to see it\./);
    expect(obscuredFitText(['PER', 'LHR'])).toMatch(/the PER and LHR endpoints .* see them\./);
    expect(fitState({ key: 'k', fits: true, hidden: ['PER'] })).toBe('full-obscured');
    expect(fitState({ key: 'k', fits: true, hidden: [] })).toBe('full');
    expect(fitState({ key: 'k', fits: false, hidden: ['PER'] })).toBe('partial');
    await act(async () => setFitNotice({ key: 'route:YPPH-EGLL', fits: true, hidden: [] }));
    expect(screen.queryByTestId('paths-fit-obscured')).toBeNull();
    // Round 5 visual-qa: a partial fit on the flat (2D) map says "drag the map", not "drag the globe".
    await act(async () => setFitNotice({ key: 'route:YPPH-EGLL', fits: false, projection: 'mercator' }));
    expect(screen.getByTestId('paths-fit-partial').textContent).toBe(partialFitText('mercator'));
    expect(partialFitText('mercator')).toMatch(/drag the map to see the rest\.$/);
    expect(partialFitText('mercator')).not.toMatch(/globe/);
    await act(async () => setFitNotice({ key: 'route:YPPH-EGLL', fits: false, projection: 'globe' }));
    expect(screen.getByTestId('paths-fit-partial').textContent).toMatch(/centred on its visible half; drag the globe to see the rest\.$/);
    await act(async () => setFitNotice(null));
  });

  it('ALL AIRFIELDS is a labelled button with the switch track inside (visual-qa M3); short placeholders (m3)', async () => {
    await act(async () => {
      renderPanel();
    });
    const toggle = screen.getByRole('button', { name: 'ALL AIRFIELDS' });
    expect(toggle.className).not.toContain('hud-toggle');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.querySelector('.hud-toggle')?.getAttribute('data-on')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByLabelText('FROM').getAttribute('placeholder')).toBe('IATA / CITY');
  });

  it('LIVE tab lists matched aircraft with progress and ETA; offline feed says so', async () => {
    useUiStore.setState({ plannedRoute: { from: 'LHR', to: 'JFK' } });
    await act(async () => {
      renderPanel();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'LIVE' }));
    });
    await waitFor(() => expect(screen.getByText('MATCHED')).toBeTruthy(), { timeout: 5000 });
    expect(screen.getByRole('progressbar', { name: /BAW117 progress/ })).toBeTruthy();
    cleanup();
    mode.flights = { data: null, meta: meta(false), providers: {} };
    await act(async () => {
      renderPanel();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'LIVE' }));
    });
    await waitFor(() => expect(screen.getByText(/Live feed offline — last snapshot 03:12Z/)).toBeTruthy(), { timeout: 5000 });
  });

  it('FLIGHT mode tracks BA117 and shows tracker links', async () => {
    await act(async () => {
      renderPanel();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'BA117' }));
    });
    expect(useUiStore.getState().flightIdent).toBe('BA117');
    await waitFor(() => expect(screen.getByText('BAW117')).toBeTruthy(), { timeout: 5000 });
    const fa = screen.getByRole('link', { name: /FlightAware/ });
    expect(fa.getAttribute('rel')).toBe('noopener noreferrer');
    expect(fa.getAttribute('href')).toBe('https://www.flightaware.com/live/flight/BAW117');
  });

  it('unknown airport → friendly message; swap reverses the plotted route', async () => {
    useUiStore.setState({ plannedRoute: { from: 'ZZZZ', to: 'JFK' } });
    await act(async () => {
      renderPanel();
    });
    await waitFor(() => expect(screen.getByText(/Unknown airport: ZZZZ — check the code/)).toBeTruthy(), { timeout: 5000 });
    cleanup();
    useUiStore.setState({ plannedRoute: { from: 'LHR', to: 'JFK' } });
    await act(async () => {
      renderPanel();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Swap origin and destination' }));
    });
    expect(useUiStore.getState().plannedRoute).toEqual({ from: 'JFK', to: 'LHR' });
  });

  it('typing a city shows the metro chips and picking one fills the field', async () => {
    await act(async () => {
      renderPanel();
    });
    const [fromInput] = screen.getAllByRole('combobox');
    await act(async () => {
      fireEvent.change(fromInput!, { target: { value: 'London' } });
    });
    await waitFor(() => expect(screen.getByLabelText('London airports')).toBeTruthy(), { timeout: 5000 });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'LGW' }));
    });
    expect((fromInput as HTMLInputElement).value).toBe('LGW');
  });

  it('Enter on an unmatched place submits once (explicit) and picks the nearest scheduled airport', async () => {
    await act(async () => {
      renderPanel();
    });
    const [, toInput] = screen.getAllByRole('combobox');
    await act(async () => {
      fireEvent.change(toInput!, { target: { value: 'qqheathrowairfieldqq' } });
    });
    await act(async () => {
      fireEvent.keyDown(toInput!, { key: 'Enter' });
    });
    await waitFor(() => expect((toInput as HTMLInputElement).value).toBe('LHR'), { timeout: 5000 });
    const calls = (fetch as unknown as { mock: { calls: [string][] } }).mock.calls.map((c) => String(c[0]));
    expect(calls.some((c) => c.includes('submit=1'))).toBe(true);
  });

  it('a palette route whose name resolves no airport pre-fills FROM/TO and says so (R4-m6)', async () => {
    const { setPathsDraft } = await import('./draft');
    await act(async () => {
      renderPanel();
    });
    await act(async () => {
      setPathsDraft({ from: 'Atlantis', to: 'New York', unresolved: ['Atlantis'] });
    });
    const [fromInput, toInput] = screen.getAllByRole('combobox');
    expect((fromInput as HTMLInputElement).value).toBe('Atlantis');
    expect((toInput as HTMLInputElement).value).toBe('New York');
    expect(screen.getByRole('status').textContent).toMatch(/No airport found for "Atlantis"/);
    await act(async () => {
      setPathsDraft(null);
    });
    expect(screen.queryByText(/No airport found/)).toBeNull();
  });

  it('a palette name that only fuzzy-matched offers "Did you mean ACY (Atlantic City)?" and one click plans it (round 4 M2)', async () => {
    const { setPathsDraft } = await import('./draft');
    useUiStore.setState({ plannedRoute: null, flightIdent: null });
    await act(async () => {
      renderPanel();
    });
    await act(async () => {
      setPathsDraft({ from: 'Atlantis', to: 'LHR', unresolved: ['Atlantis'], failed: [], same: null, suggestions: [{ side: 'from', text: 'Atlantis', code: 'ACY', label: 'Atlantic City' }] });
    });
    expect(screen.getByRole('status').textContent).toBe('No airport named "Atlantis". Did you mean ACY (Atlantic City)?');
    expect(useUiStore.getState().plannedRoute).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Use ACY (Atlantic City) as origin' }));
    });
    expect(useUiStore.getState().plannedRoute).toEqual({ from: 'ACY', to: 'LHR' });
    expect(screen.queryByText(/Did you mean/)).toBeNull();
  });
});

describe('FLIGHT chip freshness (round 4 M3)', () => {
  const NOW = Date.parse('2026-10-01T05:31:00Z');
  const at = (ageS: number) => ({ lat: 40, lng: -74, altFt: 35000, gsKt: 450, trackDeg: 90, observedAt: new Date(NOW - ageS * 1000).toISOString() });
  it('LIVE only within 1.5x the 60 s flights cadence, RECENT after, STALE when old; never LIVE from a stale feed', async () => {
    const { flightChip } = await import('./PathsPanel');
    expect(flightChip({ status: 'airborne', position: at(13), feedState: 'live' }, NOW)).toEqual(['LIVE', 'live']);
    expect(flightChip({ status: 'airborne', position: at(135), feedState: 'live' }, NOW)).toEqual(['RECENT', 'idle']);
    expect(flightChip({ status: 'airborne', position: at(143), feedState: 'live' }, NOW)).toEqual(['RECENT', 'idle']);
    expect(flightChip({ status: 'airborne', position: at(400), feedState: 'live' }, NOW)).toEqual(['STALE', 'warn']);
    expect(flightChip({ status: 'airborne', position: at(5), feedState: 'stale' }, NOW)).toEqual(['STALE', 'warn']);
    expect(flightChip({ status: 'airborne', position: at(5) }, NOW)).toEqual(['RECENT', 'idle']);
    expect(flightChip({ status: 'landed', position: null, feedState: null }, NOW)).toEqual(['LANDED', 'idle']);
  });
});
