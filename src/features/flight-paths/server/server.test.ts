import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as RateLimitModule from '@/lib/ratelimit';
import type * as HttpModule from '@/lib/http';
import { MemoryStore, clearL1, setStore } from '@/lib/cache';
import openmeteo from '../__fixtures__/openmeteo-250hpa-3pt.json';
import { HOURLY_BUDGET, openMeteoUrl, resetWinds, snap, windsAloft, type WindsFetcher } from './winds';
import { FPDB_DISCLAIMER, filedPlans, mapFpdbPlans } from './fpdb';
import { stationFor, stationWeather } from './weather';
import { findAirport, vrsIndex, buildVrsIndex } from './data';
import { boost, exactMatches, fuzzyMatches, nearestScheduled } from './airports';

const http = vi.hoisted(() => ({ body: null as unknown, status: 200, calls: [] as string[] }));
vi.mock('@/lib/ratelimit', async (orig) => {
  const actual = await orig<typeof RateLimitModule>();
  return { ...actual, providerBucket: () => ({ take: async () => undefined, tryTake: () => true }) };
});
vi.mock('@/lib/http', async (orig) => {
  const actual = await orig<typeof HttpModule>();
  return {
    ...actual,
    httpJson: vi.fn(async (u: string, opts: { headers?: Record<string, string> }) => {
      http.calls.push(`${u} ${opts?.headers?.Authorization ?? ''}`);
      if (http.status >= 400) throw new actual.HttpError(`HTTP ${http.status}`, 'http', u, http.status);
      return { data: http.body, status: http.status, ok: true, notModified: false, headers: {}, body: Buffer.alloc(0), url: u, etag: null, lastModified: null, ms: 1, attempts: 1 };
    }),
  };
});

const samples = [
  { fraction: 0.25, point: [-10.3, 52.9] as [number, number] },
  { fraction: 0.5, point: [-30.1, 55.2] as [number, number] },
  { fraction: 0.75, point: [-30.4, 55.6] as [number, number] }, // same 2° cell as the previous one
];

describe('winds aloft', () => {
  beforeEach(() => resetWinds());

  it('one multi-coordinate request per route, then the 1 h grid cache', async () => {
    const calls: [number, number][][] = [];
    const fetcher: WindsFetcher = async (cells) => {
      calls.push([...cells]);
      return cells.map(() => openmeteo.body[0]!);
    };
    const now = Date.parse('2026-09-30T20:00:00Z');
    const a = await windsAloft(samples, { fetcher, env: {}, now });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(2); // two distinct grid cells
    expect(a.winds.map((w) => w.speedKt)).toEqual([91.4, 91.4, 91.4]);
    expect(a.run.status.ok).toBe(true);
    await windsAloft(samples, { fetcher, env: {}, now: now + 30 * 60_000 });
    expect(calls).toHaveLength(1);
    await windsAloft(samples, { fetcher, env: {}, now: now + 2 * 3_600_000 });
    expect(calls).toHaveLength(2);
  });

  it('licence gate, hourly budget and malformed answers', async () => {
    expect((await windsAloft(samples, { env: { COMMERCIAL_DEPLOYMENT: 'true' } })).run.status.skipped).toBe('licence');
    const now = Date.parse('2026-09-30T20:00:00Z');
    const bad = await windsAloft(samples, { fetcher: async () => [openmeteo.body[0]!], env: {}, now });
    expect(bad.run.status).toMatchObject({ ok: false, error: 'parse' });
    const failing: WindsFetcher = async () => {
      throw new Error('HTTP 429');
    };
    for (let i = 1; i < HOURLY_BUDGET; i++) await windsAloft(samples, { fetcher: failing, env: {}, now });
    expect((await windsAloft(samples, { fetcher: failing, env: {}, now })).run.status.skipped).toBe('budget');
  });

  it('default fetcher: array or single object; grid snapping', async () => {
    http.status = 200;
    http.body = openmeteo.body;
    const three = [
      { fraction: 0.2, point: [-0.45, 51.47] as [number, number] },
      { fraction: 0.5, point: [-30, 55] as [number, number] },
      { fraction: 0.8, point: [-60, 60] as [number, number] },
    ];
    const r = await windsAloft(three, { env: {}, now: 1 });
    expect(r.winds.map((w) => w.dirDeg)).toEqual([180, 277, 299]);
    // R6: each sample names the model grid point that answered and the forecast hour (recorded GMT time).
    expect(r.winds[0]).toMatchObject({ lat: 51.47, lng: -0.45, cellLat: Math.round(openmeteo.body[0]!.latitude * 100) / 100, cellLng: Math.round(openmeteo.body[0]!.longitude * 100) / 100, validAt: '2026-09-30T20:00:00.000Z' });
    expect(r.winds[2]).toMatchObject({ validAt: '2026-09-30T20:00:00.000Z' });
    expect(Math.abs(r.winds[2]!.cellLat! - 60)).toBeLessThan(0.2);
    resetWinds();
    http.body = openmeteo.body[0];
    const one = await windsAloft([three[0]!], { env: {}, now: 1 });
    expect(one.winds[0]!.speedKt).toBe(91.4);
    expect(snap(51.47)).toBe(52);
    expect(snap(-0.45)).toBe(-0);
    expect(openMeteoUrl([[52, 0]])).toContain('wind_speed_250hPa');
  });
});

describe('FlightPlanDatabase (keyed)', () => {
  beforeEach(() => {
    clearL1();
    setStore(new MemoryStore());
    http.calls = [];
  });

  it('maps documented plan nodes and always carries the sim-only disclaimer', () => {
    const plans = mapFpdbPlans([
      { id: 7, distance: 3000.4, route: { nodes: [{ type: 'APT', ident: 'EGLL', lat: 51.47, lon: -0.46, alt: 0 }, { type: 'FIX', ident: 'DOGAL', lat: 54, lon: -15, alt: 35000, via: { ident: 'NATA' } }] } },
      { id: 8, route: { nodes: [{ ident: 'X', lat: 99, lon: 0 }] } },
    ]);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ id: 'fpdb:7', distanceNm: 3000, disclaimer: FPDB_DISCLAIMER });
    expect(plans[0]!.waypoints[1]).toMatchObject({ ident: 'DOGAL', via: 'NATA', altFt: 35000 });
  });

  it('skipped without a key; Basic auth with the key; 502 is an honest failure', async () => {
    expect((await filedPlans('EGLL', 'KJFK', {})).run.status.skipped).toBe('not-configured');
    http.status = 200;
    http.body = [{ id: 1, route: { nodes: [{ ident: 'A', lat: 1, lon: 1 }, { ident: 'B', lat: 2, lon: 2 }] } }];
    const ok = await filedPlans('EGLL', 'KJFK', { FPDB_API_KEY: 'k' });
    expect(ok.plans).toHaveLength(1);
    expect(http.calls[0]).toContain(`Basic ${Buffer.from('k:').toString('base64')}`);
    expect(http.calls[0]).not.toContain('k@');
    http.status = 502;
    const bad = await filedPlans('LFPG', 'KJFK', { FPDB_API_KEY: 'k' });
    expect(bad.plans).toEqual([]);
    expect(bad.run.status.ok).toBe(false);
  });
});

describe('weather + airports helpers', () => {
  beforeEach(() => {
    clearL1();
    setStore(new MemoryStore());
  });

  it('stationWeather: TAF failure alone keeps the METAR', async () => {
    const r = await stationWeather(['EGLL', null, 'LHR'], {
      metar: async () => [{ icaoId: 'EGLL', rawOb: 'METAR EGLL 301950Z AUTO 19007KT 9999 NCD 18/11 Q1014', obsTime: 1790797800, fltCat: 'VFR' }],
      taf: async () => {
        throw new Error('HTTP 502');
      },
    });
    expect(r.byStation.get('EGLL')?.metar).toMatch(/^METAR/);
    expect(r.providers.awc_taf?.status.ok).toBe(false);
    expect((await stationWeather([null])).byStation.size).toBe(0);
    expect(stationFor({ icao: null, gps: 'K00A', ident: '00A' })).toBe('K00A');
    expect(stationFor({ icao: null, gps: null, ident: 'X1' })).toBeNull();
  });

  it('exact, fuzzy, boosts and nearest scheduled', () => {
    expect(exactMatches('EGLL', false)[0]?.matchedBy).toBe('icao');
    expect(exactMatches('<>', false)).toEqual([]);
    const lhr = findAirport('LHR')!;
    expect(boost(lhr, 'london')).toBe(3 + 3 + 1 + 2);
    expect(fuzzyMatches('gatwick', false)[0]?.iata).toBe('LGW');
    const near = nearestScheduled(51.5, -0.12);
    expect(near.map((n) => n.a.iata)).toEqual(expect.arrayContaining(['LCY', 'LHR']));
    expect(near.every((n) => n.km <= 150)).toBe(true);
    expect(findAirport('')).toBeNull();
    expect(findAirport('00AK')?.type).toBe('small_airport');
  });

  it('VRS index: multi-stop chains yield every ordered pair', () => {
    const idx = buildVrsIndex({ version: 1, generatedAt: '2026-09-30T20:00:00Z', lastModified: null, licence: 'CC0-1.0', chains: { 'YSSY-WSSS-EGLL': ['QFA1'], 'EGLL-KJFK': ['BAW117'] } });
    expect(idx.byPair.get('YSSY-EGLL')).toEqual(['QFA1']);
    expect(idx.byPair.get('WSSS-EGLL')).toEqual(['QFA1']);
    expect(idx.byPair.get('EGLL-YSSY')).toBeUndefined();
    expect(idx.chainOf.get('QFA1')).toEqual(['YSSY', 'WSSS', 'EGLL']);
    expect(idx.size).toBe(2);
    expect(vrsIndex().chainOf.get('BAW117')).toEqual(['EGLL', 'KJFK']);
  });
});
