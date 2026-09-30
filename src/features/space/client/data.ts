'use client';
/**
 * Client data for the space module: fetchers, the catalogue holder (module-level, never zustand),
 * and a tiny store for the selected satellite's 1 Hz telemetry (one entity, not bulk data).
 * Owner: layers-space.
 */
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { FeedMeta, IssResponse, Mission, OrbitResponse, Providers, SatCategory, SatellitesResponse, SpaceWeatherResponse } from '@/lib/types';
import { COL, rowToRecord, type SatRecord } from '../lib/catalog';
import { packedRecord, type CardRecord, type PackedCatalogue } from '../lib/packed';
import type { CatalogueSummary } from '../lib/propagator';

/** An upstream-offline answer (503) keeps its meta so the UI can show SOURCE OFFLINE + last-good. */
export class FeedOfflineError extends Error {
  constructor(
    readonly status: number,
    readonly meta: FeedMeta | null,
    readonly providers: Providers | null,
  ) {
    super(status === 503 ? 'source_offline' : `http_${status}`);
    this.name = 'FeedOfflineError';
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { meta?: FeedMeta; providers?: Providers } | null;
    throw new FeedOfflineError(res.status, body?.meta ?? null, body?.providers ?? null);
  }
  return (await res.json()) as T;
}

/** One satellite's elements (small response; the full catalogue is fetched by the worker only). */
export const fetchSatelliteById = (noradId: number) => getJson<SatellitesResponse>(`/api/satellites?id=${encodeURIComponent(String(noradId))}`);
export const fetchIss = () => getJson<IssResponse>('/api/iss');
export const fetchSpaceWeather = () => getJson<SpaceWeatherResponse>('/api/space-weather');
export const fetchOrbit = (noradId: number, anchorMs: number) =>
  getJson<OrbitResponse>(`/api/satellites/orbit?id=${encodeURIComponent(String(noradId))}&t=${Math.round(anchorMs)}`);

export const satelliteByIdQueryKey = (noradId: number) => ['space', 'satellites', 'id', noradId] as const;
export const orbitQueryKey = (noradId: number, anchorMs: number) => ['space', 'orbit', noradId, Math.round(anchorMs)] as const;

// ── Catalogue holder ────────────────────────────────────────────────────────────
// Filled from the propagation worker's packed catalogue (typed arrays, transferred): the main
// thread never parses or clones the /api/satellites rows.
interface CatalogueView {
  version: string;
  packed: PackedCatalogue;
  missions: readonly Mission[];
  source: 'celestrak' | 'satnogs-fallback';
  meta: FeedMeta;
}

let current: CatalogueView | null = null;
let byId: Map<number, number> | null = null;

export function setCatalogue(version: string, summary: CatalogueSummary, packed: PackedCatalogue | null): CatalogueView | null {
  const p = packed ?? (current?.version === version ? current.packed : null);
  if (!p) return current;
  if (p !== current?.packed) byId = null;
  current = { version, packed: p, missions: summary.missions, source: summary.catalogueSource, meta: summary.meta };
  useSpaceStore.getState().bump();
  return current;
}

export function catalogue(): CatalogueView | null {
  return current;
}

/** Catalogue index of a NORAD id (the id map is built on first use, not per catalogue load). */
export function indexOfId(noradId: number): number | undefined {
  if (!current) return undefined;
  if (!byId) {
    const ids = current.packed.noradIds;
    byId = new Map();
    for (let i = 0; i < ids.length; i++) byId.set(ids[i]!, i);
  }
  return byId.get(noradId);
}

export function recordAt(index: number): CardRecord | null {
  return current ? packedRecord(current.packed, index) : null;
}

export function recordById(noradId: number): CardRecord | null {
  const i = indexOfId(noradId);
  return i === undefined ? null : recordAt(i);
}

// ── Selected-satellite telemetry (1 Hz, one entity) ─────────────────────────────
export interface SatTelemetry {
  noradId: number;
  lng: number;
  lat: number;
  altKm: number;
  velocityKmS: number;
  shadow: boolean;
  /** ms epoch the position was propagated for. */
  at: number;
}

interface SpaceState {
  catalogueVersion: number;
  telemetry: SatTelemetry | null;
  /** Time of the last propagated frame (ms), for orbit anchoring. */
  frameAt: number | null;
  bump: () => void;
  setFrame: (at: number, telemetry: SatTelemetry | null) => void;
}

export const useSpaceStore = create<SpaceState>((set) => ({
  catalogueVersion: 0,
  telemetry: null,
  frameAt: null,
  bump: () => set((s) => ({ catalogueVersion: s.catalogueVersion + 1 })),
  setFrame: (frameAt, telemetry) => set({ frameAt, telemetry }),
}));

/** The ISS (or any) record straight from a satellites response, without the catalogue holder. */
export function recordFromResponse(resp: SatellitesResponse | undefined, noradId: number): SatRecord | null {
  const row = resp?.rows.find((r) => r[COL.noradId] === noradId);
  return row ? rowToRecord(row) : null;
}

/** Selection payload for a satellite (small object; the card reads it). */
export interface SatelliteSelectionData extends Record<string, unknown> {
  noradId: number;
  name: string;
  objectId: string;
  epoch: string;
  meanMotion: number;
  eccentricity: number;
  inclination: number;
  category: SatCategory;
  mission: string;
  catalogueSource: 'celestrak' | 'satnogs-fallback';
  /** ms epoch the orbit track is anchored on (the frame the marker was drawn for). */
  anchorAt: number;
}

export function selectionDataFor(
  rec: CardRecord,
  anchorAt: number,
  from: Pick<SatellitesResponse, 'missions' | 'catalogueSource'> | null = null,
): SatelliteSelectionData {
  const cat = from ? { missions: from.missions, source: from.catalogueSource ?? 'celestrak' } : catalogue();
  return {
    noradId: rec.noradId,
    name: rec.name,
    objectId: rec.objectId,
    epoch: rec.epoch,
    meanMotion: rec.meanMotion,
    eccentricity: rec.eccentricity,
    inclination: rec.inclination,
    category: rec.category,
    mission: cat?.missions[rec.missionIndex]?.name ?? 'Unclassified',
    catalogueSource: cat?.source ?? 'celestrak',
    anchorAt,
  };
}

/** A clock for "x ago" labels (render must stay pure: no Date.now() in render). */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
