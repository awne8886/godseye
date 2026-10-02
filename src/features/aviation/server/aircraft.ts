/**
 * Aircraft detail lookup for GET /api/aircraft: adsbdb identity (+ photo URLs, passed through,
 * never downloaded or stored) and the adsb.lol readsb trace (current leg of the flown track).
 * Both upstreams are optional: a failure becomes `null`/`[]` and shows in `providers`.
 * Server-only.
 */
import 'server-only';
import type { z } from 'zod';
import { httpJson, HttpError } from '@/lib/http';
import { providerBucket } from '@/lib/ratelimit';
import { sourceCache } from '@/lib/cache';
import { runProvider, type ProviderRun } from '@/lib/feeds';
import { freshnessState, toIso } from '@/lib/freshness';
import type { AircraftDetailResponse, AircraftIdentity } from '@/lib/schemas/aviation';
import type { Providers } from '@/lib/types';
import { currentLeg, downsample, latestSource, mergeTraces, parseTrace, toTrackPoints, type TraceFile, type TraceRow } from '../trace';
import { ADSBLOL_ATTRIBUTION } from '../feeds';

export type AircraftDetail = z.infer<typeof AircraftDetailResponse>;
type Identity = z.infer<typeof AircraftIdentity>;

export const ADSBDB_AIRCRAFT = (hex: string) => `https://api.adsbdb.com/v0/aircraft/${hex.toUpperCase()}`;
export const TRACE_URL = (hex: string, kind: 'full' | 'recent') => `https://adsb.lol/data/traces/${hex.slice(-2)}/trace_${kind}_${hex}.json`;

export const adsbdbBucket = () => providerBucket('api.adsbdb.com', 2, 2);
const tracesBucket = () => providerBucket('adsb.lol-traces', 2, 2);

interface AdsbdbAircraft {
  type?: string;
  icao_type?: string;
  manufacturer?: string;
  mode_s?: string;
  registration?: string;
  registered_owner_country_iso_name?: string;
  registered_owner?: string;
  registered_owner_operator_flag_code?: string;
  url_photo?: string | null;
  url_photo_thumbnail?: string | null;
}

const httpsUrl = (v: string | null | undefined): string | null => {
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
};
const text = (v: string | null | undefined) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function identityFrom(hex: string, a: AdsbdbAircraft | null, trace: TraceFile | null): Identity | null {
  if (!a && !trace) return null;
  const photoUrl = httpsUrl(a?.url_photo);
  const photoThumbUrl = httpsUrl(a?.url_photo_thumbnail);
  return {
    hex,
    registration: text(a?.registration) ?? text(trace?.r),
    typeCode: text(a?.icao_type) ?? text(trace?.t),
    model: text(trace?.desc) ?? ([text(a?.manufacturer), text(a?.type)].filter(Boolean).join(' ') || null),
    manufacturer: text(a?.manufacturer),
    operator: text(a?.registered_owner),
    operatorIcao: text(a?.registered_owner_operator_flag_code),
    country: text(a?.registered_owner_country_iso_name),
    photoUrl,
    photoThumbUrl,
    photoCredit: photoUrl || photoThumbUrl ? `Photo: ${new URL((photoUrl ?? photoThumbUrl)!).hostname.replace(/^image\./, '')} via adsbdb` : null,
  };
}

async function fetchAdsbdb(hex: string, signal?: AbortSignal): Promise<AdsbdbAircraft | null> {
  try {
    const res = await httpJson<{ response?: { aircraft?: AdsbdbAircraft } | string }>(ADSBDB_AIRCRAFT(hex), {
      signal,
      timeoutMs: 8_000,
      retries: 0,
      limiter: adsbdbBucket(),
    });
    const r = res.data?.response;
    return r && typeof r === 'object' && r.aircraft ? r.aircraft : null;
  } catch (e) {
    // adsbdb answers 404 {"response":"unknown aircraft"}: a truthful "not in the registry".
    if (e instanceof HttpError && e.status === 404) return null;
    throw e;
  }
}

async function fetchTrace(hex: string, kind: 'full' | 'recent', signal?: AbortSignal): Promise<TraceFile | null> {
  try {
    const res = await httpJson<TraceFile>(TRACE_URL(hex, kind), { signal, timeoutMs: 12_000, retries: 1, limiter: tracesBucket() });
    return res.data ?? null;
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return null; // no trace today for this hex
    throw e;
  }
}

export interface LookupDeps {
  adsbdb: (hex: string) => Promise<AdsbdbAircraft | null>;
  trace: (hex: string, kind: 'full' | 'recent') => Promise<TraceFile | null>;
}

const defaultDeps: LookupDeps = { adsbdb: (h) => fetchAdsbdb(h), trace: (h, k) => fetchTrace(h, k) };

interface Stored {
  identity: Identity | null;
  track: ReturnType<typeof toTrackPoints>;
  trackSource: string | null;
  providers: Record<string, ProviderRun>;
  observedAt: number | null;
}

export async function buildAircraftDetail(hex: string, deps: LookupDeps = defaultDeps): Promise<Stored> {
  const [idRun, fullRun, recentRun] = await Promise.all([
    runProvider(() => deps.adsbdb(hex), () => 1, { allowEmpty: true }),
    runProvider(() => deps.trace(hex, 'full'), (t) => (t ? 1 : 0), { allowEmpty: true }),
    runProvider(() => deps.trace(hex, 'recent'), (t) => (t ? 1 : 0), { allowEmpty: true }),
  ]);
  const full = parseTrace(fullRun.result);
  const recent = parseTrace(recentRun.result);
  const rows: TraceRow[] = mergeTraces(full, recent);
  const leg = downsample(currentLeg(rows), 700);
  const traceFile = fullRun.result ?? recentRun.result ?? null;
  const identity = identityFrom(hex, idRun.result, traceFile);
  const traceOk = fullRun.run.status.ok || recentRun.run.status.ok;
  const traceMs = Math.max(fullRun.run.status.ms, recentRun.run.status.ms);
  const traceRun: ProviderRun = {
    status: { ok: traceOk, count: leg.length, ms: traceMs, age_s: traceOk ? 0 : null, ...(traceOk ? {} : { error: fullRun.run.status.error ?? 'error' }) },
    okAt: traceOk ? Date.now() : null,
  };
  const adsbdbRun: ProviderRun = { ...idRun.run, status: { ...idRun.run.status, count: idRun.result ? 1 : 0 } };
  return {
    identity,
    track: toTrackPoints(leg),
    trackSource: latestSource(rows),
    providers: { adsbdb: adsbdbRun, adsblol_trace: traceRun },
    observedAt: rows.length ? rows[rows.length - 1]!.at : null,
  };
}

const TTL_MS = 120_000;

function providersAt(runs: Record<string, ProviderRun>, now: number): Providers {
  return Object.fromEntries(Object.entries(runs).map(([k, r]) => [k, { ...r.status, age_s: r.okAt ? Math.round((now - r.okAt) / 1000) : null }]));
}

/** Cached lookup (2 min per hex). Returns null only when every upstream failed. */
export async function aircraftDetail(hex: string, deps: LookupDeps = defaultDeps): Promise<AircraftDetail | null> {
  const cache = sourceCache<Stored>(`aircraft:${hex}`, async () => ({ data: await buildAircraftDetail(hex, deps) }), { ttlMs: TTL_MS, retryAfterErrorMs: 30_000, deadlineMs: 20_000 });
  const r = await cache.get();
  if (!r.data || r.fetchedAt === null) return null;
  const s = r.data;
  const now = Date.now();
  const anyOk = Object.values(s.providers).some((p) => p.status.ok);
  if (!anyOk) return null;
  return {
    hex,
    identity: s.identity,
    track: s.track,
    trackSource: s.trackSource,
    meta: {
      feed: 'aircraft',
      kind: 'live',
      state: s.observedAt === null ? 'stale' : freshnessState({ kind: 'live', at: s.observedAt, cadenceMs: 60_000, now }),
      fetchedAt: toIso(r.fetchedAt),
      observedAt: toIso(s.observedAt),
      lastGoodAt: toIso(r.fetchedAt),
      stale: r.stale,
      ttlSeconds: TTL_MS / 1000,
      attribution: [ADSBLOL_ATTRIBUTION, { text: 'Aircraft registry: adsbdb.com', url: 'https://www.adsbdb.com/' }],
      note: 'Track = current leg from adsb.lol readsb traces (split on ≥ 4 ground samples, ≤ 700 points)',
    },
    providers: providersAt(s.providers, now),
  };
}
