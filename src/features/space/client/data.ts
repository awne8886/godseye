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

export const fetchSatellites = () => getJson<SatellitesResponse>('/api/satellites');
export const fetchIss = () => getJson<IssResponse>('/api/iss');
export const fetchSpaceWeather = () => getJson<SpaceWeatherResponse>('/api/space-weather');
export const fetchOrbit = (noradId: number, anchorMs: number) =>
  getJson<OrbitResponse>(`/api/satellites/orbit?id=${encodeURIComponent(String(noradId))}&t=${Math.round(anchorMs)}`);

export const SATELLITES_QUERY_KEY = ['space', 'satellites'] as const;
export const orbitQueryKey = (noradId: number, anchorMs: number) => ['space', 'orbit', noradId, Math.round(anchorMs)] as const;

// ── Catalogue holder ────────────────────────────────────────────────────────────
interface CatalogueView {
  rows: readonly (readonly unknown[])[];
  byId: Map<number, number>;
  missions: readonly Mission[];
  source: 'celestrak' | 'satnogs-fallback';
  meta: FeedMeta;
}

let current: CatalogueView | null = null;

export function setCatalogue(resp: SatellitesResponse): CatalogueView {
  if (current && current.rows === resp.rows) return current;
  const byId = new Map<number, number>();
  resp.rows.forEach((r, i) => byId.set(r[COL.noradId] as number, i));
  current = { rows: resp.rows, byId, missions: resp.missions, source: resp.catalogueSource ?? 'celestrak', meta: resp.meta };
  useSpaceStore.getState().bump();
  return current;
}

export function catalogue(): CatalogueView | null {
  return current;
}

export function recordAt(index: number): SatRecord | null {
  const row = current?.rows[index];
  return row ? rowToRecord(row) : null;
}

export function recordById(noradId: number): SatRecord | null {
  const i = current?.byId.get(noradId);
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

export function selectionDataFor(rec: SatRecord, anchorAt: number): SatelliteSelectionData {
  const cat = catalogue();
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
