/**
 * Test-only helpers: recorded upstream payloads captured 2026-09-30 from live probes (see
 * docs/data-sources/panels-alerts-markets-dossier-graph.md; large payloads trimmed: Telegram pages
 * to their last 6–8 posts, DefiLlama to the latest 40 hacks, NVD to 6 CVEs, Wikidata Q95 to the
 * followed claims) and a URL router for vi.mock('@/lib/http').
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { clearL1, MemoryStore, setStore } from '@/lib/cache';

const DIR = join(process.cwd(), 'src/components/panels/intel/__fixtures__');

export const fixtureBuffer = (name: string): Buffer => readFileSync(join(DIR, name));
export const fixtureText = (name: string): string => readFileSync(join(DIR, name), 'utf8');
export const fixtureJson = <T = unknown>(name: string): T => JSON.parse(fixtureText(name)) as T;

export const FX = {
  tgOsint: 'tg-Osintdefender.2026-09-30.html',
  tgRybar: 'tg-rybar_in_english.2026-09-30.html',
  tgKyiv: 'tg-KyivIndependent_official.2026-09-30.html',
  bbc: 'bbc-world.2026-09-30.xml',
  yahooGspc: 'yahoo-gspc-1d-5m.2026-09-30.json',
  yahooGc: 'yahoo-gcf-1mo-1d.2026-09-30.json',
  binance: 'binance-24hr.2026-09-30.json',
  coinbaseTicker: 'coinbase-btc-ticker.2026-09-30.json',
  coinbaseStats: 'coinbase-btc-stats.2026-09-30.json',
  kraken: 'kraken-ticker.2026-09-30.json',
  usgs: 'usgs-2.5_day.2026-09-30.json',
  llama: 'llama-hacks-latest40.2026-09-30.json',
  nvd: 'nvd-cryptocurrency.2026-09-30.json',
  wiki: 'wikipedia-summary-kyiv.2026-09-30.json',
  photon: 'photon-reverse-kyiv.2026-09-30.json',
  sparqlUA: 'wikidata-sparql-country-UA.2026-09-30.json',
  wdQ95: 'wikidata-entity-Q95.2026-09-30.json',
  ripeWhois: 'ripe-whois-8.8.8.8.2026-09-30.json',
  ripeNetInfo: 'ripe-network-info-8.8.8.8.2026-09-30.json',
  ripeAsOverview: 'ripe-as-overview-AS15169.2026-09-30.json',
  ripeNeighbours: 'ripe-asn-neighbours-AS15169.2026-09-30.json',
} as const;

/** Fixture capture time (the probes ran 2026-09-30 ~20:03 UTC); tests pin Date.now near it. */
export const CAPTURED_AT = Date.parse('2026-09-30T20:05:00Z');

export type Route = [string, string | Buffer | number];

type ErrorCtor = new (message: string, code: 'http' | 'network', url: string, status?: number) => Error;

export interface Call {
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
}

/**
 * vi.mock('@/lib/http') implementations answering from the first route whose substring occurs in
 * the URL; unmatched URLs fail like a network error. Every call is recorded in `calls`.
 */
export function httpMock(routes: () => Route[], HttpError: ErrorCtor, calls: Call[] = []) {
  const find = (url: string) => routes().find(([k]) => url.includes(k))?.[1];
  const request = async (input: string | URL, opts: { headers?: Record<string, string>; body?: string | Buffer } = {}) => {
    const url = String(input);
    calls.push({ url, headers: opts.headers ?? {}, body: typeof opts.body === 'string' ? opts.body : undefined });
    const hit = find(url);
    if (hit === undefined) throw new HttpError('network', 'network', url);
    if (typeof hit === 'number') throw new HttpError(`HTTP ${hit}`, 'http', url, hit);
    const body = typeof hit === 'string' ? fixtureBuffer(hit) : hit;
    return { status: 200, ok: true, notModified: false, headers: {}, body, url, etag: null, lastModified: null, ms: 1, attempts: 1 };
  };
  return {
    httpRequest: request,
    httpText: async (input: string | URL, opts?: { headers?: Record<string, string> }) => {
      const r = await request(input, opts);
      return { ...r, text: r.body.toString('utf8') };
    },
    httpJson: async (input: string | URL, opts?: { headers?: Record<string, string>; body?: string }) => {
      const r = await request(input, opts);
      return { ...r, data: JSON.parse(r.body.toString('utf8')) as unknown };
    },
  };
}

let n = 0;

/** A request from a distinct client IP each time (per-IP limits never interfere) unless `ip` is given. */
export function req(path: string, init: { method?: string; headers?: Record<string, string>; body?: unknown; ip?: string } = {}): Request {
  n++;
  const ip = init.ip ?? `10.88.${(n >> 8) & 255}.${n & 255}`;
  return new Request(`http://localhost${path}`, {
    method: init.method ?? 'GET',
    headers: { 'x-forwarded-for': ip, ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...init.headers },
    ...(init.body !== undefined ? { body: typeof init.body === 'string' ? init.body : JSON.stringify(init.body) } : {}),
  });
}

export function freshCache(): void {
  clearL1();
  setStore(new MemoryStore());
}

export function resetCache(): void {
  setStore(undefined);
}

/** Every recorded upstream route for a keyless happy path. */
export const HAPPY: Route[] = [
  ['t.me/s/Osintdefender', FX.tgOsint],
  ['t.me/s/rybar_in_english', FX.tgRybar],
  ['t.me/s/KyivIndependent_official', FX.tgKyiv],
  ['feeds.bbci.co.uk', FX.bbc],
  ['timesofisrael.com', 403],
  ['tass.com', 403],
  ['summary/2.5_day.geojson', FX.usgs],
  ['data-api.binance.vision', FX.binance],
  ['query1.finance.yahoo.com', FX.yahooGspc],
  ['api.llama.fi/hacks', FX.llama],
  ['services.nvd.nist.gov', FX.nvd],
];
