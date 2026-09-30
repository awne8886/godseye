/**
 * USGS earthquake summary feeds (GeoJSON, public domain). Owner: layers-hazards. Server-only.
 *
 * Probed 2026-09-30: `summary/2.5_day.geojson` 200 in 0.43 s, CORS `*`, Last-Modified set.
 * Normalisation lives in usgs-parse.ts (depthKm = coordinates[2], lower-case alert, tsunami bool,
 * origin time as observedAt).
 */
import 'server-only';
import { defineFeed, runProvider, type Feed } from '@/lib/feeds';
import { httpJson } from '@/lib/http';
import type { Earthquake } from '@/lib/types';
import { normalizeUsgs, type UsgsCollection } from './usgs-parse';
import { newestObservation, type Collected } from './collected';

export const USGS_FEEDS = ['all_hour', 'all_day', '2.5_day', '4.5_day', '4.5_week', 'significant_week'] as const;
export type UsgsFeedName = (typeof USGS_FEEDS)[number];
export const DEFAULT_USGS_FEED: UsgsFeedName = '2.5_day';

const USGS_BASE = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/';

export const USGS_ATTRIBUTION = [
  { text: 'Earthquakes: U.S. Geological Survey (USGS) Earthquake Hazards Program', url: 'https://earthquake.usgs.gov/earthquakes/feed/', licence: 'Public domain' },
];

/** Feeds where "no quake right now" is a truthful answer (an M2.5+ hour, a significant week). */
const MAY_BE_EMPTY: ReadonlySet<UsgsFeedName> = new Set(['all_hour', 'significant_week']);

function feedFor(name: UsgsFeedName): Feed<Collected<Earthquake>> {
  const isDefault = name === DEFAULT_USGS_FEED;
  const allowEmpty = MAY_BE_EMPTY.has(name);
  return defineFeed<Collected<Earthquake>>({
    key: isDefault ? 'earthquakes' : `earthquakes:${name}`,
    ttlMs: 60_000,
    // Poll at half the TTL so the snapshot never ages past 1.5 x TTL (LIVE) between polls; USGS
    // answers conditional GETs cheaply.
    pollMs: 30_000,
    kind: 'live',
    attribution: USGS_ATTRIBUTION,
    // The default feed is a core feed: polled from boot (instrumentation).
    eager: isDefault,
    count: (d) => d.items.length,
    isEmpty: (d) => !d.answered || (!allowEmpty && d.items.length === 0),
    run: async ({ signal, etag, lastModified, previous }) => {
      let notModified = false;
      const { result, run } = await runProvider(
        async () => {
          const res = await httpJson<UsgsCollection>(`${USGS_BASE}${name}.geojson`, {
            signal,
            etag: previous ? etag : null,
            lastModified: previous ? lastModified : null,
            timeoutMs: 15_000,
          });
          if (res.notModified) {
            notModified = true;
            return { items: previous?.items ?? [], etag: res.etag, lastModified: res.lastModified };
          }
          return { items: normalizeUsgs(res.data!), etag: res.etag, lastModified: res.lastModified };
        },
        (r) => r.items.length,
        { allowEmpty },
      );
      if (notModified && previous) return { notModified: true };
      const items = result?.items ?? [];
      return {
        data: { items, answered: run.status.ok },
        providers: { usgs: run },
        observedAt: newestObservation(items),
        etag: result?.etag ?? null,
        lastModified: result?.lastModified ?? null,
      };
    },
  });
}

const cache = new Map<UsgsFeedName, Feed<Collected<Earthquake>>>();

export function earthquakeFeed(name: UsgsFeedName = DEFAULT_USGS_FEED): Feed<Collected<Earthquake>> {
  let f = cache.get(name);
  if (!f) {
    f = feedFor(name);
    cache.set(name, f);
  }
  return f;
}
