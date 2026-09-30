'use client';
/**
 * Aviation map layer (flights / private / jets / military). Per-frame data lives in refs and
 * typed arrays (layers.ts); React only holds the published layer list. Every aircraft the feed
 * returns is drawn (no decimation) as a heading-rotated SDF billboard, dead-reckoned from its own
 * track and speed for at most 60 s after its observation, then frozen and dimmed. Above 20k points
 * on the globe at world zoom the icons give way to an H3 aggregate (no deck Hexagon/Heatmap on
 * the globe). Emergency squawks are ringed and posted to the Intel Feed.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import type { LayersList } from '@deck.gl/core';
import type { LayerComponentProps } from '@/lib/feature-module';
import { getLayer, type LayerId } from '@/lib/layer-registry';
import { useDeckLayers, useFeedEventStore, useLayerStatusStore, useMapInstance, useMapInstanceStore, useSelectionStore } from '@/lib/layer-host';
import { useUiStore } from '@/lib/store';
import type { FeedEvent } from '@/lib/types';
import type { FlightRecord } from '../adsb';
import type { Bucket } from '../classify';
import type { TrackPoint } from '../trace';
import type { AircraftDetail } from '../server/aircraft';
import { AGGREGATE_ABOVE, AGGREGATE_BELOW_ZOOM, advanceFrame, aggregateH3, buildLayers, newFrame, type Frame, type H3Cell, type View } from './layers';
import { BUCKET_LAYER, useAviationPrefs, useFlights } from './useFlights';
import { EMERGENCY_LABEL } from './format';

const Z = getLayer('flights')?.z ?? 80;
const TICK_MS = 1000;
const SEVERITY: Record<'7500' | '7600' | '7700', FeedEvent['severity']> = { '7500': 'critical', '7700': 'high', '7600': 'medium' };

export default function AviationLayer({ active }: LayerComponentProps) {
  const { data } = useFlights(true);
  const map = useMapInstance();
  const projection = useMapInstanceStore((s) => s.projection);
  const theme = useUiStore((s) => s.theme);
  const watched = useUiStore((s) => s.watchedFlights);
  const colorMode = useAviationPrefs((s) => s.colorMode);
  const selectedId = useSelectionStore((s) => (s.selection?.kind === 'aircraft' ? s.selection.id : null));
  const selectedLabel = useSelectionStore((s) => {
    const d = s.selection?.kind === 'aircraft' ? (s.selection.data as Partial<FlightRecord>) : null;
    return d ? (d.callsign ?? d.registration ?? d.id ?? '') : null;
  });
  const updateStatus = useLayerStatusStore((s) => s.update);
  const pushEvents = useFeedEventStore((s) => s.push);

  const buckets = useMemo(
    () => new Set((Object.entries(BUCKET_LAYER) as [Bucket, LayerId][]).filter(([, l]) => active.has(l)).map(([b]) => b)),
    [active],
  );

  // Flown tracks of watched aircraft (for trails); cached per hex by react-query.
  const trackQueries = useQueries({
    queries: watched.map((hex) => ({
      queryKey: ['aircraft', hex],
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const res = await fetch(`/api/aircraft?icao24=${encodeURIComponent(hex)}`, { signal });
        if (!res.ok) throw new Error(`aircraft ${hex}: HTTP ${res.status}`);
        return (await res.json()) as AircraftDetail;
      },
      enabled: /^[0-9a-f]{6}$/.test(hex),
      staleTime: 60_000,
      refetchInterval: 60_000,
    })),
  });
  const trackKey = trackQueries.map((q) => q.dataUpdatedAt).join(',');
  const tracks = useMemo(() => {
    const m = new Map<string, readonly TrackPoint[]>();
    watched.forEach((hex, i) => {
      const t = trackQueries[i]?.data?.track;
      if (t) m.set(hex, t);
    });
    return m;
  }, [watched, trackKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const frame = useRef<Frame>(newFrame([]));
  const view = useRef<View>({ center: [0, 20], zoom: 2, bearing: 0 });
  const tick = useRef(0);
  const dataVersion = useRef(0);
  const cells = useRef<H3Cell[] | null>(null);
  const [layers, setLayers] = useState<LayersList | null>(null);
  const [drawn, setDrawn] = useState(0);

  const select = useSelectionStore((s) => s.select);
  const onSelect = useCallback(
    (r: FlightRecord, lngLat: [number, number]) =>
      select({ kind: 'aircraft', id: r.id, layer: BUCKET_LAYER[r.bucket], source: r.source, observedAt: new Date(r.seenAt * 1000).toISOString(), data: { ...r }, lngLat }),
    [select],
  );

  /** Advance positions to now, refilter, and republish the layers (called from effects only). */
  const rebuild = useCallback(
    (reaggregate: boolean) => {
      const f = frame.current;
      const globe = projection === 'globe';
      advanceFrame(f, Date.now(), buckets, globe, view.current.center);
      const aggregate = globe && f.count > AGGREGATE_ABOVE && view.current.zoom < AGGREGATE_BELOW_ZOOM;
      if (!aggregate) cells.current = null;
      else if (reaggregate || !cells.current) cells.current = aggregateH3(f);
      tick.current++;
      setLayers(
        buildLayers({
          frame: f,
          view: view.current,
          tick: tick.current,
          dataVersion: dataVersion.current,
          colorMode,
          theme,
          watched,
          tracks,
          selectedId,
          cells: cells.current,
          onSelect,
        }),
      );
      setDrawn(f.count);
    },
    [projection, buckets, colorMode, theme, watched, tracks, selectedId, onSelect],
  );

  // New snapshot → fresh typed arrays (re-aggregate once per snapshot, not per tick).
  useEffect(() => {
    frame.current = newFrame(data?.records ?? []);
    dataVersion.current++;
    rebuild(true);
  }, [data, rebuild]);

  // 1 Hz dead-reckoning, paused while the tab is hidden.
  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) rebuild(false);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [rebuild]);

  // Camera moves: far-side filter, icon scale and bearing compensation (once per animation frame).
  useEffect(() => {
    if (!map) return;
    let raf = 0;
    const read = () => {
      raf = 0;
      const c = map.getCenter();
      view.current = { center: [c.lng, c.lat], zoom: map.getZoom(), bearing: map.getBearing() };
      rebuild(false);
    };
    const onMove = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    read();
    map.on('move', onMove);
    return () => {
      map.off('move', onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [map, rebuild]);

  useDeckLayers('aviation', layers, Z);

  // Rail status per active layer (honest SOURCE OFFLINE with last-good time on 503).
  useEffect(() => {
    for (const [bucket, id] of Object.entries(BUCKET_LAYER) as [Bucket, LayerId][]) {
      if (!active.has(id)) continue;
      if (!data) {
        updateStatus(id, { state: 'loading' });
        continue;
      }
      updateStatus(id, {
        state: data.meta.state,
        count: data.offline ? null : data.counts[bucket],
        fetchedAt: data.meta.fetchedAt,
        observedAt: data.meta.observedAt,
        lastGoodAt: data.meta.lastGoodAt,
        providers: data.providers,
        ...(data.offline ? { error: 'SOURCE OFFLINE' } : {}),
      });
    }
  }, [data, active, updateStatus]);

  // Intel Feed: one row per aircraft + squawk (unique within its layer; later polls update it).
  useEffect(() => {
    if (!data) return;
    const events: FeedEvent[] = [];
    for (const r of data.records) {
      if (!r.emergency || !buckets.has(r.bucket)) continue;
      events.push({
        id: `${r.id}:${r.emergency}`,
        layer: BUCKET_LAYER[r.bucket],
        entityKind: 'aircraft',
        entityId: r.id,
        title: `SQUAWK ${r.emergency} · ${r.callsign ?? r.registration ?? r.id.toUpperCase()}`,
        detail: `${EMERGENCY_LABEL[r.emergency]}${r.typeCode ? ` · ${r.typeCode}` : ''}`,
        severity: SEVERITY[r.emergency],
        observedAt: new Date(r.seenAt * 1000).toISOString(),
        lat: r.lat,
        lng: r.lng,
        source: r.source,
      });
    }
    if (events.length) pushEvents(events);
  }, [data, buckets, pushEvents]);

  // Announces only the selection (not the per-second count); counts are data attributes for tests.
  return (
    <p className="sr-only" aria-live="polite" data-testid="aviation-status" data-drawn={drawn} data-total={data?.counts.total ?? 0} data-offline={data?.offline ? '1' : '0'}>
      {selectedLabel !== null ? `Selected aircraft ${selectedLabel}` : ''}
    </p>
  );
}
