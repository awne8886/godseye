/**
 * Builds public/data/airways-us.min.json: the FAA ADDS ATS_Route layer (US airways, public domain)
 * as a bundled snapshot, so the planner makes no runtime calls against the ArcGIS org's shared
 * quota (6,000 request units a minute, answered as `{error:{code:429}}` inside an HTTP 200).
 *
 *   node --experimental-transform-types --import ./tools/ts-loader.mjs tools/build-airways.ts [--src FILE.geojson]
 *
 * Pages the FeatureServer (`where=1=1&outFields=IDENT,TYPE_CODE&outSR=4326&f=geojson&resultOffset=…`,
 * 2,000 per page, one page every 2 s); a 429 in the body (or the status) waits at least 60 s and
 * retries the same page (at most 5 times). Lines are simplified (Douglas–Peucker, 0.01°) and merged
 * by ident. `sources` records the URL and the layer's Last-Modified. `--src` builds from a saved
 * FeatureCollection (offline rebuilds; provenance still names the FAA URL). Owner: feature-flight-paths.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { AIRWAYS_FILE, FAA_ATS_ROUTE_URL, arcgisErrorCode, mergeAirwayFeatures, type AirwaysFile } from '@/features/flight-paths/lib/airways';
import { OUT_DIR, buildUserAgent } from './build-airports';

export const PAGE_SIZE = 2000;
const PAGE_GAP_MS = 2_000;
export const QUOTA_WAIT_MS = 61_000;
const MAX_QUOTA_RETRIES = 5;

export function pageUrl(offset: number): string {
  const q = new URLSearchParams({ where: '1=1', outFields: 'IDENT,TYPE_CODE', outSR: '4326', f: 'geojson', orderByFields: 'OBJECTID', resultOffset: String(offset), resultRecordCount: String(PAGE_SIZE) });
  return `${FAA_ATS_ROUTE_URL}/query?${q}`;
}

interface Page {
  features?: unknown[];
  properties?: { exceededTransferLimit?: boolean };
  exceededTransferLimit?: boolean;
}

export interface Fetcher {
  (url: string): Promise<{ status: number; lastModified: string | null; body: unknown }>;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Every feature of the layer, page by page; 429 (status or body) waits ≥ 60 s and retries. */
export async function fetchAllFeatures(get: Fetcher, wait: (ms: number) => Promise<void> = sleep): Promise<{ features: unknown[]; lastModified: string | null }> {
  const features: unknown[] = [];
  let lastModified: string | null = null;
  for (let offset = 0; ; ) {
    let res = await get(pageUrl(offset));
    let tries = 0;
    while ((res.status === 429 || arcgisErrorCode(res.body) === 429) && tries < MAX_QUOTA_RETRIES) {
      tries++;
      await wait(QUOTA_WAIT_MS);
      res = await get(pageUrl(offset));
    }
    const code = res.status !== 200 ? res.status : arcgisErrorCode(res.body);
    if (code !== null) throw new Error(`ATS_Route page at offset ${offset}: error ${code}`);
    lastModified ??= res.lastModified;
    const page = res.body as Page;
    const got = page.features ?? [];
    features.push(...got);
    const more = page.properties?.exceededTransferLimit === true || page.exceededTransferLimit === true;
    if (!more || got.length === 0) break;
    offset += got.length;
    await wait(PAGE_GAP_MS);
  }
  return { features, lastModified };
}

export function buildAirwaysFile(features: readonly unknown[], lastModified: string | null, now = new Date()): AirwaysFile {
  return {
    version: 1,
    generatedAt: now.toISOString(),
    sources: [{ url: FAA_ATS_ROUTE_URL, lastModified }],
    licence: 'US Government work (FAA Aeronautical Information Services), public domain',
    airways: mergeAirwayFeatures(features as Parameters<typeof mergeAirwayFeatures>[0]),
  };
}

async function main(argv: string[]) {
  const srcIdx = argv.indexOf('--src');
  let features: unknown[];
  let lastModified: string | null = null;
  if (srcIdx >= 0 && argv[srcIdx + 1]) {
    features = (JSON.parse(readFileSync(argv[srcIdx + 1]!, 'utf8')) as Page).features ?? [];
    const lm = argv.indexOf('--last-modified');
    lastModified = lm >= 0 ? (argv[lm + 1] ?? null) : null;
  } else {
    const headers = { 'User-Agent': buildUserAgent(), Accept: 'application/geo+json, application/json' };
    const r = await fetchAllFeatures(async (url) => {
      const res = await fetch(url, { headers });
      const text = await res.text();
      let body: unknown = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
      return { status: res.status, lastModified: res.headers.get('last-modified'), body };
    });
    features = r.features;
    lastModified = r.lastModified;
  }
  const file = buildAirwaysFile(features, lastModified);
  if (!file.airways.length) throw new Error('ATS_Route: no airways parsed — not writing an empty snapshot');
  const out = path.join(OUT_DIR, AIRWAYS_FILE);
  writeFileSync(out, JSON.stringify(file));
  console.log(`airways: ${features.length} features → ${file.airways.length} airways → ${out}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
