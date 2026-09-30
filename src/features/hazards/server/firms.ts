/**
 * Fires feed: NASA FIRMS keyless global 24 h CSVs (VIIRS S-NPP, NOAA-20, NOAA-21 + MODIS C6.1),
 * sampled by FRP, plus NASA EONET open wildfire events as a supplement. Owner: layers-hazards.
 * Server-only.
 *
 * Probed 2026-09-30: all four CSVs 200 (0.6–3.9 s; 5.8 / 6.8 / 6.4 / 1.2 MB; 71k / 81k / 77k / 16k
 * rows), ETag + Last-Modified (files refresh roughly hourly). The FIRMS area API
 * (`FIRMS_MAP_KEY`, capability `firms_area`) is not needed for the global layer.
 */
import 'server-only';
import { defineFeed, runProvider, type ProviderRun } from '@/lib/feeds';
import { httpJson, httpText } from '@/lib/http';
import type { WeatherEvent } from '@/lib/types';
import { FIRMS_FILES, parseFirmsCsv, sampleByFrp, type FireRow, type FireSatellite, type ParsedFirms } from './firms-parse';
import { normalizeEonet, type EonetResponse } from './eonet-parse';

export interface FiresData {
  rows: FireRow[];
  /** Valid pixels across every file that answered, before sampling. */
  totalDetections: number;
  perSatellite: Partial<Record<FireSatellite, number>>;
  wildfireEvents: WeatherEvent[];
}

interface FileState extends ParsedFirms {
  etag: string | null;
  lastModified: string | null;
}

// Per-file top-N kept in-process (not in the snapshot) so a 304 can reuse the parsed pixels.
const G = globalThis as unknown as { __godseyeFirmsFiles?: Map<FireSatellite, FileState> };
const FILES: Map<FireSatellite, FileState> = (G.__godseyeFirmsFiles ??= new Map());

export const FIRES_ATTRIBUTION = [
  { text: 'Active fires: NASA FIRMS (LANCE) VIIRS S-NPP / NOAA-20 / NOAA-21 and MODIS C6.1 near-real-time data', url: 'https://firms.modaps.eosdis.nasa.gov/', licence: 'NASA open data' },
  { text: 'Wildfire events: NASA EONET v3', url: 'https://eonet.gsfc.nasa.gov/', licence: 'NASA open data' },
];

const EONET_WILDFIRES = 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&category=wildfires&days=30';

async function loadFile(f: (typeof FIRMS_FILES)[number], signal: AbortSignal): Promise<FileState> {
  const prev = FILES.get(f.satellite) ?? null;
  const res = await httpText(f.url, { signal, timeoutMs: 60_000, etag: prev?.etag ?? null, lastModified: prev?.lastModified ?? null });
  if (res.notModified && prev) return prev;
  if (res.text === undefined) throw new Error('empty');
  const parsed = parseFirmsCsv(res.text, f.satellite);
  const state: FileState = { ...parsed, etag: res.etag, lastModified: res.lastModified };
  if (parsed.total > 0) FILES.set(f.satellite, state);
  return state;
}

export const firesFeed = defineFeed<FiresData>({
  key: 'fires',
  ttlMs: 15 * 60_000,
  kind: 'live',
  attribution: FIRES_ATTRIBUTION,
  note: 'FIRMS pixels sampled by fire radiative power (top 30 000), never by stride',
  // Four multi-megabyte CSV downloads: well past the default 25 s refresh deadline.
  deadlineMs: 120_000,
  count: (d) => d.rows.length,
  run: async ({ signal }) => {
    const providers: Record<string, ProviderRun> = {};
    const files = await Promise.all(
      FIRMS_FILES.map(async (f) => {
        const { result, run } = await runProvider(() => loadFile(f, signal), (r) => r.total);
        providers[f.provider] = run;
        return result && run.status.ok ? result : null;
      }),
    );
    const eonet = await runProvider(
      async () => normalizeEonet((await httpJson<EonetResponse>(EONET_WILDFIRES, { signal, timeoutMs: 20_000 })).data ?? {}, { only: ['wildfires'] }),
      (r) => r.length,
      // No open wildfire event in EONET's 30-day window is possible and truthful.
      { allowEmpty: true },
    );
    providers.eonet = eonet.run;
    const ok = files.filter((f): f is FileState => f !== null);
    const rows = sampleByFrp(ok.map((f) => f.top));
    const perSatellite: FiresData['perSatellite'] = {};
    FIRMS_FILES.forEach((f, i) => {
      const r = files[i];
      if (r) perSatellite[f.satellite] = r.total;
    });
    const newest = ok.reduce((m, f) => Math.max(m, f.newestSeenAt ?? 0), 0);
    return {
      data: { rows, totalDetections: ok.reduce((s, f) => s + f.total, 0), perSatellite, wildfireEvents: eonet.result ?? [] },
      providers,
      observedAt: newest ? newest * 1000 : null,
    };
  },
});
