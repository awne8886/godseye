/**
 * US airways near a planned route (§8 "FAA ADDS airways (US)"): the bundled ATS_Route snapshot
 * (tools/build-airways.ts, public domain) intersected with the US part of the great circle, 50 km
 * buffer. No runtime upstream call (the ArcGIS org's shared quota answers 429 inside a 200), so
 * `providers.faa_adds` reports the snapshot: ok with the age of the FAA layer's Last-Modified, or not ok when the file is
 * missing or unreadable. Server-only.
 */
import 'server-only';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ProviderRun } from '@/lib/feeds';
import type { LngLatTuple } from '@/lib/geo';
import { AIRWAYS_FILE, airwaysNear, type AirwaysFile, type NearAirway } from '../lib/airways';
import { DATA_DIR } from './data';

let cached: AirwaysFile | null | undefined;

/** The bundled snapshot (read once per process); null when absent or unreadable. */
export function airwaysFile(): AirwaysFile | null {
  if (cached !== undefined) return cached;
  try {
    const f = JSON.parse(readFileSync(path.join(DATA_DIR, AIRWAYS_FILE), 'utf8')) as AirwaysFile;
    cached = f.version === 1 && Array.isArray(f.airways) && f.airways.length > 0 ? f : null;
  } catch {
    cached = null;
  }
  return cached;
}

/** HTTP-date or ISO → ISO, else null. */
const toIso = (v: string | null | undefined): string | null => {
  const t = v ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

export interface AirwaysProvenance {
  name: string;
  url: string;
  licence: string;
  /** The FAA layer's Last-Modified at build time: the age of the data itself. */
  lastModified: string | null;
  /** When tools/build-airways.ts captured it. */
  builtAt: string;
}

export function airwaysProvenance(file: AirwaysFile): AirwaysProvenance {
  const src = file.sources[0];
  return {
    name: 'FAA ADDS ATS_Route',
    url: src?.url ?? '',
    licence: file.licence,
    lastModified: toIso(src?.lastModified),
    builtAt: toIso(file.generatedAt) ?? file.generatedAt,
  };
}

export function routeAirways(
  points: readonly LngLatTuple[],
  now = Date.now(),
  file: AirwaysFile | null = airwaysFile(),
): { airways: Omit<NearAirway, 'overlapKm'>[]; source: AirwaysProvenance | null; run: ProviderRun } {
  if (!file) return { airways: [], source: null, run: { status: { ok: false, count: 0, ms: 0, age_s: null, error: 'snapshot_missing' }, okAt: null } };
  const t0 = Date.now();
  const near = airwaysNear(file, points).map(({ ident, type, geometry }) => ({ ident, type, geometry }));
  const source = airwaysProvenance(file);
  // Age of the data = since the FAA last modified the layer (not since our build copied it).
  const modified = source.lastModified ? Date.parse(source.lastModified) : NaN;
  const age_s = Number.isFinite(modified) ? Math.max(0, Math.round((now - modified) / 1000)) : null;
  // A route with no US part has no airways to show: that is the truthful answer, not a failure.
  return { airways: near, source, run: { status: { ok: true, count: near.length, ms: Date.now() - t0, age_s }, okAt: null } };
}
