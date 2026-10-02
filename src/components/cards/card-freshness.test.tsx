// @vitest-environment jsdom
/**
 * r8 minor: the aircraft card's header badge (rail state) and body chip (feed state) disagreed for
 * one observation (header '● 22S', body 'LIVE'). The frame now computes the only verdict and the
 * body renders it, with the feed's own state and the record's latest observation as inputs.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlightRecord } from '@/features/aviation/adsb';
import type { FlightsData } from '@/features/aviation/client/useFlights';
import AircraftCard from '@/features/aviation/client/AircraftCard';
import { useLayerStatusStore, type LayerStatus, type Selection } from '@/lib/layer-host';
import type { FreshnessState } from '@/lib/types';
import { applyReport, sameReport, useCardFreshness } from './card-freshness';
import EntityCardFrame from './EntityCardFrame';

const NOW = Date.parse('2026-09-30T18:07:00Z');
const flights = vi.hoisted(() => ({ data: undefined as FlightsData | undefined }));
vi.mock('@/features/aviation/client/useFlights', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useFlights: () => ({ data: flights.data }),
}));

const rec = (agoS: number): FlightRecord => ({
  id: '4cafc4', callsign: 'RYR19WT', registration: 'EI-GXI', typeCode: 'B738', bucket: 'commercial', isHelicopter: false, onGround: false,
  lat: 52.83451, lng: -6.64775, altFt: 19525, altGeomFt: 19575, gsKt: 367.3, trackDeg: 357.5, vrFpm: 0, squawk: '1234', emergency: null,
  category: 'A3', nacP: 11, dbFlags: 0, seenAt: NOW / 1000 - agoS, source: 'adsblol_tiles', posSource: 'adsb',
});

const feedOf = (state: FlightsData['meta']['state'], r: FlightRecord): FlightsData =>
  ({
    records: [r],
    byId: new Map([[r.id, r]]),
    counts: { commercial: 1, private: 0, jet: 0, military: 0, total: 1, noPosition: 0 },
    meta: { state, fetchedAt: new Date(NOW - 5_000).toISOString(), observedAt: new Date(NOW - 5_000).toISOString(), lastGoodAt: new Date(NOW - 5_000).toISOString() },
    providers: { adsblol: { ok: true, count: 1, ms: 120, age_s: 5 } },
    offline: false,
  }) as unknown as FlightsData;

const rail = (state: LayerStatus['state']): LayerStatus => ({ state, count: 1, fetchedAt: null, observedAt: null, lastGoodAt: null, staleCount: 0 });

const selectionOf = (r: FlightRecord, observedAt: string | null): Selection => ({
  kind: 'aircraft', id: r.id, layer: 'flights', source: r.source, observedAt, data: { ...r }, lngLat: [r.lng, r.lat],
});

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client }, children);
}

async function renderCard(selection: Selection, feed: LayerStatus) {
  await act(async () => {
    render(
      wrap(
        <EntityCardFrame selection={selection} feed={feed} onClose={() => {}}>
          <AircraftCard selection={selection} />
        </EntityCardFrame>,
      ),
    );
  });
  return { header: () => screen.getByTestId('card-badge'), body: () => screen.getByTestId('freshness-badge') };
}

describe('one freshness verdict per entity card (r8)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    // The rail is downgraded: most of the layer's aircraft are past the 60 s cap.
    useLayerStatusStore.setState({ status: { flights: rail('recent') } });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    flights.data = undefined;
  });

  it('rail RECENT + feed LIVE + an observation 20 s old: header and body both read LIVE', async () => {
    const r = rec(20);
    flights.data = feedOf('live', r);
    const { header, body } = await renderCard(selectionOf(r, new Date(NOW - 20_000).toISOString()), rail('recent'));
    expect(header().textContent).toBe('LIVE');
    expect(body().textContent).toBe('LIVE');
    expect(header().getAttribute('data-state')).toBe('live');
    expect(body().getAttribute('data-state')).toBe('live');
  });

  it('uses the live record, not the selection snapshot, for the observed time (header and body agree)', async () => {
    // Selected 5 minutes ago; the aircraft has been re-observed 10 s ago since.
    const r = rec(10);
    flights.data = feedOf('live', r);
    const { header, body } = await renderCard(selectionOf(r, new Date(NOW - 5 * 60_000).toISOString()), rail('live'));
    expect(header().textContent).toBe('LIVE');
    expect(body().textContent).toBe(header().textContent);
    expect(screen.getByText('10s ago')).toBeTruthy();
  });

  it('agrees on an aged observation and on a stale feed too', async () => {
    const r = rec(5 * 60);
    flights.data = feedOf('live', r);
    const { header, body } = await renderCard(selectionOf(r, null), rail('recent'));
    expect(header().textContent).toBe('5m');
    expect(body().textContent).toBe('5m');
    cleanup();
    const fresh = rec(20);
    flights.data = feedOf('stale', fresh);
    const second = await renderCard(selectionOf(fresh, null), rail('live'));
    // Never better than the feed: a STALE feed is STALE in both places.
    expect(second.header().textContent).toBe('STALE');
    expect(second.body().textContent).toBe('STALE');
  });

  it('keeps the same header verdict on the Sources tab (the body stays mounted)', async () => {
    const r = rec(20);
    flights.data = feedOf('live', r);
    const { header } = await renderCard(selectionOf(r, new Date(NOW - 20_000).toISOString()), rail('recent'));
    await act(async () => fireEvent.click(screen.getByRole('tab', { name: 'sources' })));
    expect(header().textContent).toBe('LIVE');
    expect(screen.getByTestId('aircraft-card').closest('[role="tabpanel"]')!.hasAttribute('hidden')).toBe(true);
  });

  it('without a feed answer yet, the body falls back to the rail like the header', async () => {
    const r = rec(20);
    const { header, body } = await renderCard(selectionOf(r, null), rail('recent'));
    expect(header().textContent).toBe('20s');
    expect(body().textContent).toBe('20s');
  });
});

describe('useCardFreshness outside a frame', () => {
  afterEach(cleanup);

  function Probe({ feedState, observedAt, feed }: { feedState: FreshnessState | null; observedAt: string | null; feed: LayerStatus }) {
    const b = useCardFreshness({ layer: 'flights', feed, feedState, observedAt, now: NOW });
    return createElement('span', { 'data-testid': 'probe' }, b.label);
  }

  it('computes the same verdict the frame would (feed state replaces the rail)', () => {
    render(createElement(Probe, { feedState: 'live', observedAt: new Date(NOW - 20_000).toISOString(), feed: rail('recent') }));
    expect(screen.getByTestId('probe').textContent).toBe('LIVE');
    cleanup();
    render(createElement(Probe, { feedState: null, observedAt: new Date(NOW - 20_000).toISOString(), feed: rail('recent') }));
    expect(screen.getByTestId('probe').textContent).toBe('20s');
  });

  it('report helpers: absent values fall back, equal reports are equal', () => {
    const base = { observedAt: '2026-09-30T18:00:00.000Z', feed: rail('live') };
    expect(applyReport(base, null)).toEqual({ observedAt: base.observedAt, feed: base.feed, feedState: null });
    expect(applyReport(base, { feedState: 'stale' })).toEqual({ observedAt: base.observedAt, feed: base.feed, feedState: 'stale' });
    expect(applyReport(base, { observedAt: null }).observedAt).toBeNull();
    expect(sameReport({ feedState: 'live', observedAt: 'a' }, { feedState: 'live', observedAt: 'a' })).toBe(true);
    expect(sameReport({ feedState: 'live', observedAt: 'a' }, { feedState: 'recent', observedAt: 'a' })).toBe(false);
    expect(sameReport(null, { feedState: 'live' })).toBe(false);
  });
});
