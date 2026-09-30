/**
 * Client stores shared between the map host (map-engine), feature modules and the HUD.
 * Per-frame entity data never lives here: modules keep typed arrays in refs/workers and only
 * publish finished deck layers, counts and status. Owner: lead.
 */
'use client';

import { useEffect } from 'react';
import { create } from 'zustand';
import type { LayersList } from '@deck.gl/core';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { LayerId } from './layer-registry';
import type { EntityKind, FeedEvent, FreshnessState, Providers } from './types';

// ── Deck layers published by feature modules ─────────────────────────────────────
interface DeckEntry {
  layers: LayersList;
  /** Registry z of the module's lowest layer; the host sorts entries by it. */
  z: number;
}

interface DeckLayerState {
  entries: Record<string, DeckEntry>;
  version: number;
  set: (key: string, entry: DeckEntry) => void;
  remove: (key: string) => void;
}

export const useDeckLayerStore = create<DeckLayerState>((set) => ({
  entries: {},
  version: 0,
  set: (key, entry) => set((s) => ({ entries: { ...s.entries, [key]: entry }, version: s.version + 1 })),
  remove: (key) =>
    set((s) => {
      if (!(key in s.entries)) return s;
      const entries = { ...s.entries };
      delete entries[key];
      return { entries, version: s.version + 1 };
    }),
}));

/** Flattened deck layers ordered by z (the host passes this to MapLibreOverlay.setProps). */
export function orderedDeckLayers(entries: Record<string, DeckEntry>): LayersList {
  return Object.values(entries)
    .sort((a, b) => a.z - b.z)
    .flatMap((e) => e.layers);
}

/** Publish (and on unmount withdraw) a module's deck layers. Pass a new array only when layers change. */
export function useDeckLayers(key: string, layers: LayersList | null, z: number): void {
  const set = useDeckLayerStore((s) => s.set);
  const remove = useDeckLayerStore((s) => s.remove);
  useEffect(() => {
    if (layers) set(key, { layers, z });
    else remove(key);
  }, [key, layers, z, set, remove]);
  useEffect(() => () => remove(key), [key, remove]);
}

// ── Map instance (provided by the map host) ─────────────────────────────────────
interface MapInstanceState {
  map: MapLibreMap | null;
  /** 'globe' or 'mercator' as currently applied. */
  projection: 'globe' | 'mercator';
  /** True after the first `idle` (sources may be added from then on). */
  ready: boolean;
  setMap: (map: MapLibreMap | null) => void;
  setProjection: (p: 'globe' | 'mercator') => void;
  setReady: (r: boolean) => void;
}

export const useMapInstanceStore = create<MapInstanceState>((set) => ({
  map: null,
  projection: 'globe',
  ready: false,
  setMap: (map) => set({ map, ready: false }),
  setProjection: (projection) => set({ projection }),
  setReady: (ready) => set({ ready }),
}));

export function useMapInstance(): MapLibreMap | null {
  const map = useMapInstanceStore((s) => s.map);
  const ready = useMapInstanceStore((s) => s.ready);
  return ready ? map : null;
}

// ── Per-layer status (rail badges, freshness LEDs, SOURCE OFFLINE) ───────────────
export interface LayerStatus {
  state: FreshnessState | 'idle' | 'loading';
  count: number | null;
  fetchedAt: string | null;
  observedAt: string | null;
  lastGoodAt: string | null;
  error?: string;
  providers?: Providers;
  /** Per-sub-category counts (satellite categories). */
  categoryCounts?: Record<string, number>;
}

const IDLE: LayerStatus = { state: 'idle', count: null, fetchedAt: null, observedAt: null, lastGoodAt: null };

interface LayerStatusState {
  status: Partial<Record<LayerId, LayerStatus>>;
  update: (id: LayerId, patch: Partial<LayerStatus>) => void;
}

export const useLayerStatusStore = create<LayerStatusState>((set) => ({
  status: {},
  update: (id, patch) => set((s) => ({ status: { ...s.status, [id]: { ...(s.status[id] ?? IDLE), ...patch } } })),
}));

export function useLayerStatus(id: LayerId): LayerStatus {
  return useLayerStatusStore((s) => s.status[id] ?? IDLE);
}

// ── Selection (entity card) ─────────────────────────────────────────────────────
export interface Selection {
  kind: EntityKind;
  id: string;
  layer: LayerId | null;
  /** Provider key that supplied the record (shown on the card with its attribution). */
  source: string;
  /** Upstream observation time (drives the card's freshness badge); null for reference data. */
  observedAt: string | null;
  /** The entity record as rendered (small object, never a bulk array). */
  data: Record<string, unknown>;
  lngLat: [number, number] | null;
}

interface SelectionState {
  selection: Selection | null;
  select: (s: Selection) => void;
  clear: () => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selection: null,
  select: (selection) => set({ selection }),
  clear: () => set({ selection: null }),
}));

// ── Intel Feed events ────────────────────────────────────────────────────────────
export const MAX_FEED_EVENTS = 500;

interface FeedEventState {
  events: FeedEvent[];
  /** Merge a layer's events (deduped by id, newest first, capped). */
  push: (events: FeedEvent[]) => void;
}

export const useFeedEventStore = create<FeedEventState>((set) => ({
  events: [],
  push: (incoming) =>
    set((s) => {
      if (!incoming.length) return s;
      // Ids are only unique within a layer (a Feodo C2 and a URLhaus host can share an IP key).
      const seen = new Set<string>();
      const merged = [...incoming, ...s.events]
        .filter((e) => {
          const k = `${e.layer}\u0000${e.id}`;
          return seen.has(k) ? false : (seen.add(k), true);
        })
        // By time, not by string: '…:00Z' vs '…:00.900Z' sort wrongly as text.
        .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))
        .slice(0, MAX_FEED_EVENTS);
      return { events: merged };
    }),
}));
