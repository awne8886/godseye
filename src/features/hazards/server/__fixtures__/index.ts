/**
 * Test-only helpers: recorded upstream payloads (captured 2026-09-30 from live probes, see
 * docs/data-sources/layers-hazards.md) and a URL router for vi.mock('@/lib/http').
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'src/features/hazards/server/__fixtures__');

export const fixtureBuffer = (name: string): Buffer => readFileSync(join(DIR, name));
export const fixtureText = (name: string): string => readFileSync(join(DIR, name), 'utf8');
export const fixtureJson = <T = unknown>(name: string): T => JSON.parse(fixtureText(name)) as T;

export const FX = {
  usgs: 'usgs-2.5_day.2026-09-30.json',
  eonet: 'eonet-open.2026-09-30.json',
  nws: 'nws-alerts-active.2026-09-30.json',
  zone: 'nws-zone-county-ILC007.2026-09-30.json',
  gdacs: 'gdacs-geteventlist.2026-09-30.json',
  nhc: 'nhc-currentstorms.2026-09-30.json',
  cone: 'nhc-at3-cone.2026-09-30.json',
  gvp: 'gvp-weekly.2026-09-30.xml',
  aq: 'openmeteo-aq.2026-09-30.json',
  radar: 'rainviewer-maps.2026-09-30.json',
  stac: 'cdse-stac-search.2026-09-30.json',
  gpsManifest: 'gpsjam-manifest.2026-09-30.csv',
  gpsDay: 'gpsjam-2026-09-29-h3_4.2026-09-30.csv',
  /** adsb.lol /v2/point/29.5/48.0/250 (Kuwait/Gulf), 2026-09-30 22:5x UTC: one r4 cell with 5 aircraft, one NACp 0. */
  adsbGulf: 'adsblol-point-29.5_48.0_250.2026-09-30.json',
  /** adsb.lol /v2/point/55.5/21.0/250 (Baltic), same night: degraded aircraft, but none in a cell with ≥ 3 NACp reporters. */
  adsbBaltic: 'adsblol-point-55.5_21.0_250.2026-09-30.json',
  snpp: 'SUOMI_VIIRS_C2_Global_24h.2026-09-30.csv',
  j1: 'J1_VIIRS_C2_Global_24h.2026-09-30.csv',
  j2: 'J2_VIIRS_C2_Global_24h.2026-09-30.csv',
  modis: 'MODIS_C6_1_Global_24h.2026-09-30.csv',
} as const;

/** A minimal HttpResult-like object for mocked httpJson/httpText/httpRequest. */
export function okResult(url: string, body: Buffer) {
  return {
    status: 200,
    ok: true,
    notModified: false,
    headers: {},
    body,
    url,
    etag: null,
    lastModified: null,
    ms: 1,
    attempts: 1,
  };
}

/** URL substring → fixture file name, a Buffer, or an HTTP status to fail with. */
export type Route = [string, string | Buffer | number];

type ErrorCtor = new (message: string, code: 'http' | 'network', url: string, status?: number) => Error;

/**
 * Implementations for vi.mock('@/lib/http'): each call is answered from the first route whose
 * substring occurs in the URL; unmatched URLs fail like a network error (tests never hit the
 * network). Pass the real HttpError so provider errors read `http_503` / `network`.
 */
export function httpMock(routes: () => Route[], HttpError: ErrorCtor) {
  const find = (url: string) => routes().find(([k]) => url.includes(k))?.[1];
  const request = async (input: string | URL) => {
    const url = String(input);
    const hit = find(url);
    if (hit === undefined) throw new HttpError('network', 'network', url);
    if (typeof hit === 'number') throw new HttpError(`HTTP ${hit}`, 'http', url, hit);
    return okResult(url, typeof hit === 'string' ? fixtureBuffer(hit) : hit);
  };
  return {
    httpRequest: request,
    httpText: async (input: string | URL) => {
      const r = await request(input);
      return { ...r, text: r.body.toString('utf8') };
    },
    httpJson: async (input: string | URL) => {
      const r = await request(input);
      return { ...r, data: JSON.parse(r.body.toString('utf8')) as unknown };
    },
  };
}
