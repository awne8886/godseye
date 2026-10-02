/**
 * Test-only helpers for layers-threats-network: recorded upstream payloads (captured 2026-09-30
 * from the live probes in docs/data-sources/layers-threats-network.md, trimmed) and a URL router
 * for vi.mock('@/lib/http'). Imported only from *.test.ts files.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIRS = [join(process.cwd(), 'src/features/threats/server/__fixtures__'), join(process.cwd(), 'src/features/network/server/__fixtures__')];

export function fixture(name: string): Buffer {
  for (const d of DIRS) {
    try {
      return readFileSync(join(d, name));
    } catch {
      // try the next directory
    }
  }
  throw new Error(`fixture ${name} not found`);
}

export const FX = {
  gdeltLast: 'gdelt-lastupdate.2026-09-30.txt',
  gdeltZip: 'gdelt-20260930200000.export.CSV.2026-09-30.zip',
  gdacs: 'gdacs-geteventlist.2026-09-30.json',
  wikidata: 'wikidata-nuclear.2026-09-30.json',
  informWf: 'inform-workflows-2026.2026-09-30.json',
  inform: 'inform-scores-515.2026-09-30.json',
  wgi: 'wgi-pv-2023.2026-09-30.json',
  urlhaus: 'urlhaus-csv_recent.2026-09-30.csv',
  feodo: 'feodo-ipblocklist.2026-09-30.json',
  threatfox: 'threatfox-recent.2026-09-30.json',
  ipapi: 'ipapi-batch.2026-09-30.json',
  kev: 'cisa-kev.2026-09-30.json',
  nvd: 'nvd-CVE-2021-44228.2026-09-30.json',
  ioda: 'ioda-outages-events.2026-09-30.json',
  cfRadar401: 'cloudflare-radar-401.2026-09-30.json',
  news: 'news-items.2026-10-02.json',
} as const;

/** URL substring → fixture name, Buffer, an HTTP status to fail with, 304, or a function of the request. */
export type Answer = string | Buffer | number | ((url: string, opts: { method?: string; body?: string | Buffer; etag?: string | null; lastModified?: string | null }) => string | Buffer | number);
export type Route = [string, Answer];

type ErrorCtor = new (message: string, code: 'http' | 'network', url: string, status?: number) => Error;

export interface Call {
  url: string;
  method: string;
  body?: string;
  etag?: string | null;
  lastModified?: string | null;
}

export function httpMock(routes: () => Route[], HttpError: ErrorCtor, calls?: Call[]) {
  const request = async (input: string | URL, opts: { method?: string; body?: string | Buffer; etag?: string | null; lastModified?: string | null } = {}) => {
    const url = String(input);
    calls?.push({ url, method: opts.method ?? 'GET', body: opts.body?.toString(), etag: opts.etag, lastModified: opts.lastModified });
    let hit = routes().find(([k]) => url.includes(k))?.[1];
    if (typeof hit === 'function') hit = hit(url, opts);
    if (hit === undefined) throw new HttpError('network', 'network', url);
    const base = { headers: {}, url, ms: 1, attempts: 1, etag: 'W/"fx"', lastModified: 'Wed, 30 Sep 2026 19:55:39 GMT' };
    if (hit === 304) return { ...base, status: 304, ok: false, notModified: true, body: Buffer.alloc(0) };
    if (typeof hit === 'number') throw new HttpError(`HTTP ${hit}`, 'http', url, hit);
    return { ...base, status: 200, ok: true, notModified: false, body: typeof hit === 'string' ? fixture(hit) : hit };
  };
  return {
    httpRequest: request,
    httpText: async (input: string | URL, opts?: Parameters<typeof request>[1]) => {
      const r = await request(input, opts);
      return { ...r, text: r.notModified ? undefined : r.body.toString('utf8') };
    },
    httpJson: async (input: string | URL, opts?: Parameters<typeof request>[1]) => {
      const r = await request(input, opts);
      return { ...r, data: r.notModified ? undefined : (JSON.parse(r.body.toString('utf8')) as unknown) };
    },
  };
}
