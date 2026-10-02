/**
 * GDACS Global Incidents (EQ, TC, FL, VO, DR, WF). Owner: layers-threats-network. Server-only.
 *
 * Probed 2026-09-30: `geteventlist/SEARCH?eventlist=EQ;TC;FL;VO;DR;WF` 200 in 0.94 s (89 events,
 * ACAO *); the `/MAP` variant answers 400. Alert levels arrive capitalised ("Orange") and are
 * lower-cased; dates are zone-less UTC ("2026-09-30T13:48:57") and go through normalizeUtc().
 * The URL constant and feature type are imported from the hazards parser (same upstream).
 */
import 'server-only';
import { GDACS_URL, type GdacsFeature } from '@/features/hazards/server/weather-parse';
import { defineFeed, runProvider } from '@/lib/feeds';
import { normalizeUtc } from '@/lib/freshness';
import { httpJson } from '@/lib/http';
import type { GdacsIncident } from '@/lib/types';

const TYPES = new Set(['EQ', 'TC', 'FL', 'VO', 'DR', 'WF']);

function httpUrl(u: unknown): string | null {
  if (typeof u !== 'string' || !/^https?:\/\//i.test(u)) return null;
  try {
    return new URL(u).toString();
  } catch {
    return null;
  }
}

export function normalizeGdacsIncidents(fc: { features?: GdacsFeature[] }): GdacsIncident[] {
  const out: GdacsIncident[] = [];
  const seen = new Set<string>();
  for (const f of fc.features ?? []) {
    const p = f.properties ?? {};
    const kind = String(p.eventtype ?? '').toUpperCase();
    if (p.eventid === undefined || p.eventid === null) continue;
    const coords = f.geometry?.type === 'Point' ? (f.geometry.coordinates ?? []) : [];
    const [lng, lat] = coords as number[];
    if (typeof lat !== 'number' || typeof lng !== 'number' || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const eventType = (TYPES.has(kind) ? kind : 'OTHER') as GdacsIncident['eventType'];
    const id = `gdacs-${kind || 'X'}-${p.eventid}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const level = String(p.alertlevel ?? '').toLowerCase();
    const fromDate = normalizeUtc(p.fromdate);
    const toDate = normalizeUtc(p.todate);
    out.push({
      id,
      lat,
      lng,
      observedAt: normalizeUtc(p.datemodified) ?? toDate ?? fromDate,
      source: 'gdacs',
      eventType,
      title: String(p.name || p.description || `${kind} ${p.eventid}`).slice(0, 240),
      alertLevel: level === 'green' || level === 'orange' || level === 'red' ? level : null,
      country: p.country ? String(p.country) : null,
      url: httpUrl(p.url?.report),
      fromDate,
      toDate,
    });
  }
  return out;
}

export const GDACS_ATTRIBUTION = [{ text: 'Global incidents: GDACS (European Commission JRC / UN OCHA)', url: 'https://www.gdacs.org/', licence: 'GDACS terms of use, attribution' }];

export const gdacsFeed = defineFeed<{ items: GdacsIncident[] }>({
  key: 'gdacs',
  ttlMs: 10 * 60_000,
  pollMs: 5 * 60_000,
  kind: 'live',
  attribution: GDACS_ATTRIBUTION,
  count: (d) => d.items.length,
  run: async ({ signal }) => {
    const { result, run } = await runProvider(
      async () => normalizeGdacsIncidents((await httpJson<{ features?: GdacsFeature[] }>(GDACS_URL, { signal, timeoutMs: 20_000 })).data ?? {}),
      (r) => r.length,
    );
    const items = result ?? [];
    let newest = 0;
    for (const i of items) {
      const t = i.observedAt ? Date.parse(i.observedAt) : 0;
      if (t > newest && t <= Date.now() + 60_000) newest = t;
    }
    return { data: { items }, providers: { gdacs: run }, observedAt: newest || null };
  },
});
