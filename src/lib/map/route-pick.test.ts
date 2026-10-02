// Round 8 (feature-flight-paths × map-engine): a route endpoint or diversion dot under the pointer
// opens its airport card even when a matched aircraft's ring (priority 100) lies within the pick
// tolerance; the airport selection itself has no registry layer (priority −1).
import { afterEach, describe, expect, it } from 'vitest';
import type { Layer } from '@deck.gl/core';
import type { LngLatTuple } from '@/lib/geo';
import type { Selection } from '@/lib/layer-host';
import type { Live, Plan } from '@/features/flight-paths/client/api';
import { buildRouteLayers, DIVERSION_MARK_PX, ENDPOINT_MARK_PX } from '@/features/flight-paths/client/layers';
import { greatCircle } from '@/features/flight-paths/lib/geometry';
import { collectCandidates, type DeckPickInfo, type PickMap, registerHitTester, resetPicking, routePick, setPickOverlay } from './picking';

const LHR: LngLatTuple = [-0.4614, 51.4775];
const JFK: LngLatTuple = [-73.7789, 40.6398];
const endpoint = (ident: string, iata: string, [lng, lat]: LngLatTuple) => ({ ident, icao: ident, iata, name: `${iata} airport`, lat, lng, tz: null, municipality: null, isoCountry: 'GB' });
const plan = {
  origin: endpoint('EGLL', 'LHR', LHR),
  destination: endpoint('KJFK', 'JFK', JFK),
  greatCircle: greatCircle(LHR, JFK),
  // A diversion airport on the route (Shannon), with an inbound aircraft just next to it.
  diversionAirports: [{ code: 'SNN', name: 'Shannon', runwayM: 3199, distanceFromPathKm: 30, alongPathKm: 500, lat: 52.702, lng: -8.9248 }],
  airways: [],
} as unknown as Plan;

/** Route-framing scale: 20 px per degree (flat), so 0.5° is 10 px. */
const PX_PER_DEG = 20;
const map: PickMap = {
  project: ([lng, lat]) => ({ x: (lng + 80) * PX_PER_DEG, y: (60 - lat) * PX_PER_DEG }),
  unproject: ([x, y]) => {
    const ll = { lng: x / PX_PER_DEG - 80, lat: 60 - y / PX_PER_DEG };
    return { ...ll, wrap: () => ll };
  },
  getZoom: () => 3.5,
  getCenter: () => ({ lng: -40, lat: 50 }),
  getLayer: () => undefined,
  queryRenderedFeatures: () => [],
};
const screen = (p: LngLatTuple) => map.project(p);

// DAL3, a matched JFK→LHR arrival 10 px east of the LHR dot (its 9 px ring reaches over the dot),
// and an aircraft 6 px from the SNN dot.
const live = {
  aircraft: [
    { hex: 'a1b2c3', callsign: 'DAL3', lat: LHR[1], lng: LHR[0] + 0.5, basis: 'matched', direction: 'reverse', progress: 0.99, observedAt: '2026-10-02T10:00:00Z' },
    { hex: 'd4e5f6', callsign: 'EIN105', lat: 52.702, lng: -8.9248 - 0.3, basis: 'matched', direction: 'forward', progress: 0.1, observedAt: '2026-10-02T10:00:00Z' },
  ],
} as unknown as Live;
const aircraft = (hex: string): Selection => ({ kind: 'aircraft', id: hex, layer: 'flights', source: 'adsblol_tiles', observedAt: '2026-10-02T10:00:00Z', data: {}, lngLat: [0, 0] });
const layers = buildRouteLayers({ plan, live, flight: null, globe: false, center: [-40, 50], zoom: 3.5, theme: 0, aircraftSelect: aircraft }) as Layer[];
const byId = (id: string) => layers.find((l) => l.id === id)!;
/** What deck's `pickMultipleObjects` returns: one info per picked object, top-most first. */
const info = (layerId: string, match: (d: { id: string }) => boolean): DeckPickInfo => {
  const l = byId(layerId);
  const data = l.props.data as { id: string }[];
  const index = data.findIndex(match);
  return { object: data[index], index, layer: { id: l.id, props: l.props as unknown as Record<string, unknown> } };
};

afterEach(() => resetPicking());

const clickAt = (point: { x: number; y: number }, infos: DeckPickInfo[]) => {
  setPickOverlay({ pickMultipleObjects: () => infos, pickObject: () => null });
  return routePick(collectCandidates(map, point));
};

describe('route endpoint / diversion picks against overlapping aircraft (round 8)', () => {
  const lhr = screen(LHR);
  // The ring (drawn above the dot) and the dot, as the GPU pick at the LHR dot returns them.
  const atLhr = [info('route-live-aircraft', (d) => d.id === 'a1b2c3'), info('route-endpoints', (d) => d.id === 'EGLL')];

  it('the LHR dot under the pointer opens LHR, not the matched aircraft ring next to it', () => {
    const sel = clickAt({ x: lhr.x, y: lhr.y }, atLhr);
    expect(sel).toMatchObject({ kind: 'airport', id: 'EGLL', data: { code: 'LHR', role: 'endpoint' } });
    // Anywhere on the drawn dot (5 px + its 2 px ring + the antialiased edge).
    expect(clickAt({ x: lhr.x + ENDPOINT_MARK_PX - 0.5, y: lhr.y }, atLhr)?.id).toBe('EGLL');
  });

  it('before the fix the aircraft (priority 100) won over the airport (no registry layer, −1)', () => {
    const undeclared = atLhr.map((i) => ({ ...i, layer: { ...i.layer!, props: { ...i.layer!.props, pickMarkPx: undefined } } }));
    expect(clickAt({ x: lhr.x, y: lhr.y }, undeclared)?.id).toBe('a1b2c3');
  });

  it('outside the dot the aircraft keeps its priority (a pointer on the ring away from the dot)', () => {
    expect(clickAt({ x: lhr.x + ENDPOINT_MARK_PX + 1, y: lhr.y }, atLhr)?.id).toBe('a1b2c3');
  });

  it('the dot also wins over the aviation layer’s CPU hit (14 px tolerance) for the same aircraft', () => {
    const ac = screen([LHR[0] + 0.5, LHR[1]]);
    registerHitTester('aviation', (p) => [{ layer: 'flights', selection: aircraft('a1b2c3'), distancePx: Math.hypot(p.x - ac.x, p.y - ac.y) }]);
    expect(clickAt({ x: lhr.x + 1, y: lhr.y - 1 }, [atLhr[1]!])?.id).toBe('EGLL');
  });

  it('a diversion dot under the pointer opens the diversion airport', () => {
    const snn = screen([-8.9248, 52.702]);
    const atSnn = [info('route-live-aircraft', (d) => d.id === 'd4e5f6'), info('route-diversions', (d) => d.id === 'SNN')];
    expect(clickAt({ x: snn.x + 1, y: snn.y }, atSnn)).toMatchObject({ kind: 'airport', id: 'SNN', data: { role: 'diversion' } });
    expect(clickAt({ x: snn.x + DIVERSION_MARK_PX + 1, y: snn.y }, atSnn)?.id).toBe('d4e5f6');
  });
});
