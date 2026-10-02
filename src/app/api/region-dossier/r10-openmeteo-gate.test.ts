/**
 * Security (round 10): the Region Dossier's Open-Meteo weather (non-commercial free tier, capability
 * `openmeteo`) is cached for 30 min in a keyed lookup. After a restart with
 * COMMERCIAL_DEPLOYMENT=true on the same SnapshotStore, the cached weather must not be served —
 * neither right away nor as a "keep previous" after the gated refresh. "Restart" keeps the store and
 * drops the in-process L1 and lookup handles.
 */
import type * as Http from '@/lib/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAPTURED_AT, FX, type Call, type Route } from '@/components/panels/intel/__fixtures__';
import { req } from '@/components/panels/intel/__fixtures__/routes';
import { clearLookups } from '@/components/panels/intel/server/lookup';
import { clearL1, MemoryStore, setStore } from '@/lib/cache';
import { hasCapability } from '@/lib/capabilities';
import { GET } from './route';

const state = vi.hoisted(() => ({ routes: [] as Route[], calls: [] as Call[] }));
vi.mock('@/lib/http', async (importOriginal) => {
  const orig = await importOriginal<typeof Http>();
  const { httpMock } = await import('@/components/panels/intel/__fixtures__');
  return { ...orig, ...httpMock(() => state.routes, orig.HttpError, state.calls) };
});

/** Open-Meteo `current` answer in the documented shape (zone-less GMT time). */
const FORECAST = Buffer.from(JSON.stringify({ latitude: 50.45, longitude: 30.52, current: { time: '2026-09-30T20:00', temperature_2m: 11.4, wind_speed_10m: 9.7, weather_code: 3 } }));
const URL_ = '/api/region-dossier?lat=50.45&lng=30.52';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: CAPTURED_AT });
  state.calls.length = 0;
  clearL1();
  clearLookups();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  setStore(undefined);
});

function restart(): void {
  clearL1();
  clearLookups();
}

describe('Region Dossier weather after COMMERCIAL_DEPLOYMENT is switched on', () => {
  it('never serves cached Open-Meteo weather once the openmeteo gate is off', async () => {
    setStore(new MemoryStore());
    state.routes = [['photon.komoot.io/reverse', FX.photon], ['query.wikidata.org/sparql', FX.sparqlUA], ['api.open-meteo.com/v1/forecast', FORECAST]];
    const first = await (await GET(req(URL_), undefined)).json();
    expect(first.weather).toMatchObject({ temperatureC: 11.4 }); // control: cached non-commercially
    expect(first.providers['open-meteo']).toMatchObject({ ok: true });

    restart();
    vi.stubEnv('COMMERCIAL_DEPLOYMENT', 'true');
    expect(hasCapability('openmeteo')).toBe(false);
    state.routes = [['photon.komoot.io/reverse', FX.photon], ['query.wikidata.org/sparql', FX.sparqlUA]];
    state.calls.length = 0;

    const now = await (await GET(req(URL_), undefined)).json();
    expect(now.weather).toBeNull();
    expect(now.providers['open-meteo']).toMatchObject({ ok: false, skipped: 'licence' });

    // Past the TTL with nothing answering: the gated refresh is empty and must not resurrect the old weather.
    state.routes = [];
    vi.setSystemTime(CAPTURED_AT + 31 * 60_000);
    const later = await GET(req(URL_), undefined);
    const body = await later.json();
    expect(body.weather ?? null).toBeNull();
    expect(JSON.stringify(body)).not.toContain('11.4');
    expect(state.calls.filter((c) => c.url.includes('open-meteo'))).toEqual([]);
  });
});
