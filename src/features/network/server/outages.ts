/**
 * Internet outages (IODA keyless + Cloudflare Radar keyed) and Cloudflare Radar L3 attack origins.
 * Owner: layers-threats-network. Server-only.
 *
 * Probed 2026-09-30:
 *  - IODA `v2/outages/events?from&until&entityType=country&limit=200` 200 in 1.3 s (18 events,
 *    CORS reflects Origin): {location "country/BM", location_name, start (unix s), duration (s),
 *    datasource bgp|gtr|ping-slash24|merit-nt, score}. An event whose end reaches the query's
 *    `until` is still ongoing.
 *  - Cloudflare Radar `radar/attacks/layer3/top/locations/origin` 400 without a token
 *    ("Missing X-Auth-Key, X-Auth-Email or Authorization headers"): keyed via CLOUDFLARE_API_TOKEN
 *    (Authorization: Bearer), data CC BY-NC 4.0, off when COMMERCIAL_DEPLOYMENT=true.
 * Country outages are placed at the country's label point (precision: country) — IODA and Radar
 * report countries, not places. Attack origins are SHARES of traffic by origin country: drawn as
 * points; an arc would need a reported target, which this endpoint does not give.
 */
import 'server-only';
import { hasCapability } from '@/lib/capabilities';
import { defineFeed, runProvider, skippedProvider, type ProviderRun } from '@/lib/feeds';
import { httpJson } from '@/lib/http';
import { providerBucket } from '@/lib/ratelimit';
import type { AttackOrigin, Outage } from '@/lib/types';
import { countryByIso2 } from '../../threats/shared/country';

export const IODA_EVENTS = 'https://api.ioda.inetintel.cc.gatech.edu/v2/outages/events';
export const CF_BASE = 'https://api.cloudflare.com/client/v4/radar/';
const WINDOW_S = 24 * 3600;

export interface IodaEvent {
  location?: string;
  location_name?: string;
  start?: number;
  duration?: number;
  datasource?: string;
  score?: number;
}

const DATASOURCE: Record<string, string> = { bgp: 'BGP routing', 'ping-slash24': 'active probing', gtr: 'Google traffic', 'merit-nt': 'network telescope' };

/** IODA country events → outages (one per country + start + datasource). Pure. */
export function mapIoda(events: readonly IodaEvent[], untilS: number): Outage[] {
  const out: Outage[] = [];
  const seen = new Set<string>();
  for (const e of events) {
    const m = /^country\/([A-Z]{2})$/.exec(e.location ?? '');
    if (!m || typeof e.start !== 'number') continue;
    const c = countryByIso2(m[1]);
    if (!c) continue;
    const id = `ioda-${m[1]}-${e.start}-${e.datasource ?? 'x'}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const end = typeof e.duration === 'number' ? e.start + e.duration : null;
    const ongoing = end === null || end >= untilS - 600;
    const startedAt = new Date(e.start * 1000).toISOString();
    out.push({
      id,
      lat: c.lat,
      lng: c.lng,
      observedAt: startedAt,
      source: 'ioda',
      country: e.location_name || c.name,
      countryCode: m[1]!,
      scope: 'country',
      cause: null,
      description: `Signal drop in ${DATASOURCE[e.datasource ?? ''] ?? e.datasource ?? 'an IODA datasource'}${typeof e.score === 'number' ? ` (IODA score ${Math.round(e.score)})` : ''}`,
      startedAt,
      endedAt: ongoing || end === null ? null : new Date(end * 1000).toISOString(),
      ongoing,
      provider: 'IODA',
      url: `https://ioda.inetintel.cc.gatech.edu/country/${m[1]}`,
    });
  }
  return out;
}

interface CfAnnotation {
  id?: string;
  description?: string | null;
  scope?: string | null;
  startDate?: string;
  endDate?: string | null;
  locations?: string[];
  linkedUrl?: string | null;
  outage?: { outageCause?: string; outageType?: string };
}

export function mapCloudflareOutages(anns: readonly CfAnnotation[]): Outage[] {
  const out: Outage[] = [];
  for (const a of anns) {
    const start = a.startDate && Number.isFinite(Date.parse(a.startDate)) ? new Date(Date.parse(a.startDate)).toISOString() : null;
    if (!a.id || !start) continue;
    for (const cc of a.locations ?? []) {
      const c = countryByIso2(cc);
      if (!c) continue;
      const end = a.endDate && Number.isFinite(Date.parse(a.endDate)) ? new Date(Date.parse(a.endDate)).toISOString() : null;
      out.push({
        id: `cf-${a.id}-${c.iso2}`,
        lat: c.lat,
        lng: c.lng,
        observedAt: start,
        source: 'cloudflare',
        country: c.name,
        countryCode: c.iso2,
        scope: a.scope ?? a.outage?.outageType ?? null,
        cause: a.outage?.outageCause ?? null,
        description: a.description ? a.description.slice(0, 400) : null,
        startedAt: start,
        endedAt: end,
        ongoing: end === null,
        provider: 'Cloudflare Radar',
        url: a.linkedUrl && /^https?:\/\//.test(a.linkedUrl) ? a.linkedUrl : `https://radar.cloudflare.com/outage-center`,
      });
    }
  }
  return out;
}

const cfHeaders = () => ({ authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN ?? ''}` });
const cfLimiter = () => providerBucket('cloudflare-radar', 1, 3);

export const CF_ATTRIBUTION = { text: 'Cloudflare Radar', url: 'https://radar.cloudflare.com/', licence: 'CC BY-NC 4.0' };

export const outagesFeed = defineFeed<{ items: Outage[] }>({
  key: 'outages',
  ttlMs: 5 * 60_000,
  kind: 'live',
  attribution: [{ text: 'IODA, Georgia Tech Internet Intelligence Lab', url: 'https://ioda.inetintel.cc.gatech.edu/', licence: 'Attribution' }, CF_ATTRIBUTION],
  note: 'Country-level outages placed at the country label point (not a location of the outage).',
  count: (d) => d.items.length,
  isEmpty: () => false,
  deadlineMs: 40_000,
  run: async ({ signal }) => {
    const until = Math.floor(Date.now() / 1000);
    const providers: Record<string, ProviderRun> = {};
    const ioda = await runProvider(
      async () => {
        const url = `${IODA_EVENTS}?from=${until - WINDOW_S}&until=${until}&entityType=country&limit=200`;
        return mapIoda((await httpJson<{ data?: IodaEvent[] }>(url, { signal, timeoutMs: 20_000, limiter: providerBucket('ioda', 1, 2) })).data?.data ?? [], until);
      },
      (r) => r.length,
      // "No country outage in the last 24 h" is a truthful answer.
      { allowEmpty: true },
    );
    providers.ioda = ioda.run;
    let cf: Outage[] = [];
    if (hasCapability('cloudflare')) {
      const r = await runProvider(
        async () => mapCloudflareOutages((await httpJson<{ result?: { annotations?: CfAnnotation[] } }>(`${CF_BASE}annotations/outages?dateRange=7d&limit=100&format=json`, { signal, timeoutMs: 15_000, headers: cfHeaders(), limiter: cfLimiter() })).data?.result?.annotations ?? []),
        (x) => x.length,
        { allowEmpty: true },
      );
      providers.cloudflare = r.run;
      cf = r.result ?? [];
    } else providers.cloudflare = skippedProvider('not-configured');
    const answered = ioda.run.status.ok || providers.cloudflare.status.ok;
    const items = [...(ioda.result ?? []), ...cf].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
    // Only a real answer (possibly "none") is served; if every provider failed the feed is OFFLINE.
    if (!answered) throw new Error(providers.ioda.status.error ?? 'offline');
    return { data: { items }, providers };
  },
});

// ── Attack origins ───────────────────────────────────────────────────────────────
interface CfTopRow {
  originCountryAlpha2?: string;
  originCountryName?: string;
  targetCountryAlpha2?: string;
  value?: string | number;
}

export function mapOrigins(rows: readonly CfTopRow[], observedAt: string | null): AttackOrigin[] {
  const out: AttackOrigin[] = [];
  for (const r of rows) {
    const c = countryByIso2(r.originCountryAlpha2);
    const share = Number(r.value);
    if (!c || !Number.isFinite(share) || share < 0 || share > 100) continue;
    const target = r.targetCountryAlpha2 && /^[A-Z]{2}$/.test(r.targetCountryAlpha2) ? r.targetCountryAlpha2 : null;
    out.push({
      id: `cf-origin-${c.iso2}${target ? `-${target}` : ''}`,
      lat: c.lat,
      lng: c.lng,
      observedAt,
      source: 'cloudflare',
      countryCode: c.iso2,
      country: r.originCountryName || c.name,
      sharePct: share,
      ...(target ? { targetCountryCode: target } : {}),
    });
  }
  return out;
}

export const attackOriginsFeed = defineFeed<{ items: AttackOrigin[]; window: string }>({
  key: 'cloudflare-radar',
  ttlMs: 5 * 60_000,
  kind: 'live',
  attribution: [CF_ATTRIBUTION],
  note: 'Share of Layer 3 DDoS traffic by ORIGIN country over the last 24 h (points; no target is reported, so no arcs).',
  count: (d) => d.items.length,
  run: async ({ signal }) => {
    if (!hasCapability('cloudflare')) return { data: { items: [], window: '1d' }, providers: { cloudflare: skippedProvider('not-configured') } };
    let at: string | null = null;
    const { result, run } = await runProvider(
      async () => {
        const res = await httpJson<{ result?: { top_0?: CfTopRow[]; meta?: { lastUpdated?: string; dateRange?: { endTime?: string }[] } } }>(
          `${CF_BASE}attacks/layer3/top/locations/origin?dateRange=1d&limit=25&format=json`,
          { signal, timeoutMs: 15_000, headers: cfHeaders(), limiter: cfLimiter() },
        );
        const meta = res.data?.result?.meta;
        const t = meta?.lastUpdated ?? meta?.dateRange?.[0]?.endTime;
        at = t && Number.isFinite(Date.parse(t)) ? new Date(Date.parse(t)).toISOString() : null;
        return mapOrigins(res.data?.result?.top_0 ?? [], at);
      },
      (r) => r.length,
    );
    return { data: { items: result ?? [], window: '1d' }, providers: { cloudflare: run }, observedAt: at ? Date.parse(at) : null };
  },
});
