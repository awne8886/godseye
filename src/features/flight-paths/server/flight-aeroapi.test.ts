// /api/flight/{ident} with the keyed AeroAPI upgrade: FlightAware's schedule names the pair only
// when no standing-data source knows the callsign. Schedule values come from the AeroAPI v4
// docs-shaped fixture (no live capture: keyless probes answer 401).
import { describe, expect, it } from 'vitest';
import docs from '../__fixtures__/aeroapi-v4-docs-shaped.json';
import { pickFlight, toSchedule, type AeroFlight } from './aeroapi';
import { flightDetail, type FlightDeps } from './flight';

const ok = { ok: true, count: 1, ms: 1, age_s: 0 };
const NOW = Date.parse('2026-10-02T06:00:00Z');
const schedule = toSchedule(pickFlight(docs.flights_ident.flights as AeroFlight[], NOW)!);

function deps(withAero: boolean, routeFound = false): FlightDeps {
  return {
    records: async () => ({ records: [], run: { status: ok, okAt: NOW } }),
    adsblol: async () => [],
    adsbdbRegistration: async () => null,
    route: async () =>
      routeFound
        ? { found: true, source: 'vrs', stale: false, sourceUpdatedAt: '2026-09-20', origin: { icao: 'KDEN', iata: 'DEN' }, destination: { icao: 'KLAX', iata: 'LAX' }, providers: { vrs: ok } }
        : { found: false, source: null, origin: null, destination: null, providers: { vrs: ok } },
    aircraft: async () => null,
    weather: async () => ({ byStation: new Map(), providers: {} }),
    ...(withAero ? { aeroapi: async () => ({ schedule, run: { status: ok, okAt: NOW } }) } : {}),
  } as unknown as FlightDeps;
}

describe('flight detail with AeroAPI (keyed upgrade)', () => {
  it('uses the FlightAware schedule when no standing-data route exists, and says so', async () => {
    const d = (await flightDetail('UAL1002', deps(true), NOW))!;
    expect(d.origin?.iata).toBe('DEN');
    expect(d.destination?.iata).toBe('ORD');
    expect(d.routeSource).toEqual({ name: 'aeroapi', stale: false, updatedAt: null });
    expect(d.resolved.iataFlight).toBe('UA1002');
    expect(d.sources.find((s) => s.name === 'route: aeroapi')?.detail).toMatch(/2026-10-02T18:00:00Z/);
    expect(d.providers.aeroapi?.ok).toBe(true);
    // No live position: no progress, no ETA, not LIVE.
    expect(d.progress).toBeNull();
    expect(d.position).toBeNull();
  });

  it('standing data wins: AeroAPI is not called when a route is on record', async () => {
    const d = (await flightDetail('UAL1002', deps(true, true), NOW))!;
    expect(d.destination?.iata).toBe('LAX');
    expect(d.providers.aeroapi).toBeUndefined();
  });

  it('without the upgrade the route stays unknown', async () => {
    const d = (await flightDetail('UAL1002', deps(false), NOW))!;
    expect(d.origin).toBeNull();
    expect(d.routeSource).toBeNull();
  });
});
