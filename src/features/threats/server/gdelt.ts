/**
 * GDELT 2.0 event export (15-minute batches). Owner: layers-threats-network. Server-only.
 *
 * Probed 2026-09-30: `lastupdate.txt` 200 in 0.19 s (ACAO *), lists `http://` URLs → we fetch the
 * same path over https (200, 84 KB zip, 1 233 rows × 61 tab-separated columns). The GEO 2.0 API is
 * gone (404) and DOC 2.0 is throttled to 1 req / 5 s, so events come only from these files.
 * Each refresh downloads only batches it has not parsed yet; the feed aggregates the newest
 * WINDOW_BATCHES batches (1 h). Events keep their own ActionGeo coordinates (never jittered).
 */
import 'server-only';
import { defineFeed, runProvider, type ProviderRun } from '@/lib/feeds';
import { httpRequest, httpText } from '@/lib/http';
import { providerBucket } from '@/lib/ratelimit';
import type { GdeltEvent } from '@/lib/types';
import { unzipFirst } from './zip';

export const GDELT_BASE = 'https://data.gdeltproject.org/gdeltv2/';
export const WINDOW_BATCHES = 4;
const MAX_EVENTS = 5_000;

/** Latest export batch from lastupdate.txt, with the URL upgraded to https. */
export function parseLastUpdate(text: string): { ts: string; url: string } | null {
  for (const line of text.split(/\r?\n/)) {
    const url = line.trim().split(/\s+/)[2];
    const m = url && /\/(\d{14})\.export\.CSV\.zip$/i.exec(url);
    if (m) return { ts: m[1]!, url: toHttps(url) };
  }
  return null;
}

export function toHttps(url: string): string {
  return url.replace(/^http:\/\//i, 'https://');
}

/** `YYYYMMDDHHMMSS` → ISO (GDELT timestamps are UTC). */
export function gdeltTsToIso(ts: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(ts);
  if (!m) return null;
  const ms = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** The batch `n` steps (15 min each) before `ts`. */
export function previousBatch(ts: string, n: number): string {
  const iso = gdeltTsToIso(ts);
  if (!iso) throw new Error(`bad GDELT timestamp ${ts}`);
  const d = new Date(Date.parse(iso) - n * 15 * 60_000);
  const p = (v: number) => String(v).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

export const batchUrl = (ts: string) => `${GDELT_BASE}${ts}.export.CSV.zip`;

const num = (s: string | undefined): number | null => {
  if (s === undefined || s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const str = (s: string | undefined): string | null => (s && s.trim() ? s.trim() : null);

function sqlDateIso(s: string | undefined): string | null {
  const m = s && /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (!m) return null;
  const ms = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function httpUrl(s: string | undefined): string | null {
  if (!s || !/^https?:\/\//i.test(s)) return null;
  try {
    return new URL(s).toString();
  } catch {
    return null;
  }
}

/**
 * Parse one export CSV (tab-separated, no header). Column indices per the GDELT 2.0 Event codebook:
 * 0 GLOBALEVENTID · 1 SQLDATE · 6 Actor1Name · 16 Actor2Name · 26 EventCode · 28 EventRootCode ·
 * 29 QuadClass · 30 GoldsteinScale · 31 NumMentions · 32 NumSources · 33 NumArticles · 34 AvgTone ·
 * 51 ActionGeo_Type · 52 ActionGeo_FullName · 53 ActionGeo_CountryCode (FIPS 10-4) ·
 * 56 ActionGeo_Lat · 57 ActionGeo_Long · 59 DATEADDED · 60 SOURCEURL.
 * Rows without an action geolocation (type 0 or no coordinates) are counted but not returned.
 */
export function parseExport(tsv: string): { events: GdeltEvent[]; scanned: number } {
  const events: GdeltEvent[] = [];
  let scanned = 0;
  for (const line of tsv.split('\n')) {
    if (!line) continue;
    scanned++;
    const c = line.replace(/\r$/, '').split('\t');
    if (c.length < 61) continue;
    const geoType = num(c[51]);
    const lat = num(c[56]);
    const lng = num(c[57]);
    const quad = num(c[29]);
    const dateAdded = gdeltTsToIso(c[59] ?? '');
    if (!geoType || lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) continue;
    if (quad !== 1 && quad !== 2 && quad !== 3 && quad !== 4) continue;
    if (!dateAdded || !c[0]) continue;
    const goldstein = num(c[30]);
    events.push({
      id: `gdelt-${c[0]}`,
      globalEventId: c[0],
      lat,
      lng,
      observedAt: sqlDateIso(c[1]),
      source: 'gdelt',
      dateAdded,
      quadClass: quad,
      eventCode: c[26] ?? '',
      rootCode: c[28] ?? '',
      actor1: str(c[6]),
      actor2: str(c[16]),
      goldstein: goldstein !== null && goldstein >= -10 && goldstein <= 10 ? goldstein : null,
      avgTone: num(c[34]),
      numArticles: Math.max(0, Math.trunc(num(c[33]) ?? 0)),
      numMentions: Math.max(0, Math.trunc(num(c[31]) ?? 0)),
      numSources: Math.max(0, Math.trunc(num(c[32]) ?? 0)),
      place: str(c[52]),
      countryCode: str(c[53]),
      geoPrecision: Math.min(5, Math.max(0, Math.trunc(geoType))),
      sourceUrl: httpUrl(c[60]),
    });
  }
  return { events, scanned };
}

export interface GdeltData {
  items: GdeltEvent[];
  window: { from: string; to: string; batches: number };
  scanned: number;
}

interface ParsedBatch {
  events: GdeltEvent[];
  scanned: number;
}

// Parsed batches by timestamp (the newest WINDOW_BATCHES + 1 are kept).
const G = globalThis as unknown as { __godseyeGdeltBatches?: Map<string, ParsedBatch> };
const batches = (G.__godseyeGdeltBatches ??= new Map());

/** Politeness: GDELT asks for moderate use; one file download at a time, ≤ 1 per second. */
const limiter = () => providerBucket('gdelt-files', 1, 2);

async function loadBatch(ts: string, signal: AbortSignal): Promise<ParsedBatch> {
  const hit = batches.get(ts);
  if (hit) return hit;
  const res = await httpRequest(batchUrl(ts), { signal, timeoutMs: 20_000, family: 4, limiter: limiter(), maxBytes: 20 * 1024 * 1024 });
  if (!res.ok) throw new Error(`http_${res.status}`);
  const parsed = parseExport(unzipFirst(res.body).data.toString('utf8'));
  batches.set(ts, parsed);
  return parsed;
}

/** Aggregate parsed batches (newest first) into one bounded, de-duplicated list. */
export function aggregate(parsed: { ts: string; batch: ParsedBatch }[]): GdeltData {
  const seen = new Set<string>();
  const items: GdeltEvent[] = [];
  let scanned = 0;
  for (const { batch } of parsed) {
    scanned += batch.scanned;
    for (const e of batch.events) {
      if (seen.has(e.globalEventId)) continue;
      seen.add(e.globalEventId);
      items.push(e);
    }
  }
  // Newest batch first, then the most-reported events: the cap drops the least-covered old rows.
  items.sort((a, b) => Date.parse(b.dateAdded) - Date.parse(a.dateAdded) || b.numMentions - a.numMentions);
  const tss = parsed.map((p) => p.ts).sort();
  return {
    items: items.slice(0, MAX_EVENTS),
    window: { from: gdeltTsToIso(tss[0]!)!, to: new Date(Date.parse(gdeltTsToIso(tss.at(-1)!)!) + 15 * 60_000).toISOString(), batches: tss.length },
    scanned,
  };
}

export const GDELT_ATTRIBUTION = [{ text: 'Events: The GDELT Project (GDELT 2.0 Event Database)', url: 'https://www.gdeltproject.org/', licence: 'Unlimited use with citation' }];

export const gdeltFeed = defineFeed<GdeltData>({
  key: 'gdelt-events',
  ttlMs: 15 * 60_000,
  pollMs: 5 * 60_000,
  kind: 'live',
  attribution: GDELT_ATTRIBUTION,
  note: 'Machine-coded from news reports; locations are geocoded place names (precision stated per event).',
  maxObservationAgeMs: 2 * 60 * 60_000,
  deadlineMs: 60_000,
  count: (d) => d.items.length,
  run: async ({ signal }) => {
    const providers: Record<string, ProviderRun> = {};
    const latest = await runProvider(
      async () => {
        const res = await httpText(`${GDELT_BASE}lastupdate.txt`, { signal, timeoutMs: 10_000, family: 4, limiter: limiter() });
        const lu = parseLastUpdate(res.text ?? '');
        if (!lu) throw new Error('parse');
        return lu;
      },
      () => 1,
    );
    providers.lastupdate = latest.run;
    if (!latest.result) return { data: { items: [], window: { from: new Date(0).toISOString(), to: new Date(0).toISOString(), batches: 1 }, scanned: 0 }, providers };
    const wanted = Array.from({ length: WINDOW_BATCHES }, (_, i) => previousBatch(latest.result!.ts, i));
    const exports = await runProvider(
      async () => {
        const got: { ts: string; batch: ParsedBatch }[] = [];
        for (const ts of wanted) {
          try {
            got.push({ ts, batch: await loadBatch(ts, signal) });
          } catch (e) {
            // The newest batch is required; an older one that 404s (GDELT sometimes skips a slot) is not.
            if (ts === wanted[0]) throw e;
          }
        }
        return got;
      },
      (r) => r.reduce((n, b) => n + b.batch.events.length, 0),
    );
    providers.export = exports.run;
    for (const ts of [...batches.keys()]) if (!wanted.includes(ts)) batches.delete(ts);
    if (!exports.result?.length) return { data: { items: [], window: { from: new Date(0).toISOString(), to: new Date(0).toISOString(), batches: 1 }, scanned: 0 }, providers };
    const data = aggregate(exports.result);
    return { data, providers, observedAt: Date.parse(data.items[0]?.dateAdded ?? '') || null };
  },
});

/** Test hook. */
export function resetGdeltBatches(): void {
  batches.clear();
}
