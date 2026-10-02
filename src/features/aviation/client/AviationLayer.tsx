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
import { registerHitTester } from '@/lib/map/picking';
import { cameraFromMap, getFarSideCamera } from '@/lib/map/far-side';
import { useUiStore } from '@/lib/store';
import type { FeedEvent, FreshnessState } from '@/lib/types';
import type { FlightRecord } from '../adsb';
import type { Bucket } from '../classify';
import type { TrackPoint } from '../trace';
import type { AircraftDetail } from '../server/aircraft';
import { AGGREGATE_ABOVE, AGGREGATE_BELOW_ZOOM, advanceFrame, aggregateH3, buildLayers, newFrame, type Frame, type H3Cell, type View } from './layers';
import { BUCKET_LAYER, useAviationPrefs, useFlights } from './useFlights';
import { EMERGENCY_LABEL } from './format';
import { aircraftSelection, hitTestAircraft } from './select';
import { countStaleByBucket, deriveLayerState, staleKey, stalenessState, type StaleCounts } from './stale';

const Z = getLayer('flights')?.z ?? 80;
const TICK_MS = 1000;
/** Camera-driven refilters while the map moves are at least this far apart (≤ 10 Hz, perf M5). */
const CAMERA_REBUILD_MS = 100;
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
  /** Vertices of the watched-flight trails currently drawn (TripsLayer; exposed for e2e/QA). */
  const [trailVertices, setTrailVertices] = useState(0);
  const [cameraAttr, setCameraAttr] = useState('');
  /** Drawn aircraft past the 60 s dead-reckoning cap (frozen, dimmed): exposed for tests/QA. */
  const [stale, setStale] = useState(0);
  /** Per-bucket aircraft past the cap (all positions in the bucket, matching the rail count). */
  const [staleBy, setStaleBy] = useState<StaleCounts | null>(null);
  const staleByKey = useRef('');
  /** Last own staleness per bucket (hysteresis input for deriveLayerState). */
  const ownState = useRef<Partial<Record<Bucket, FreshnessState>>>({});

  /**
   * Advance positions to now, refilter, and republish the layers (called from effects only).
   * `data`: new snapshot (re-aggregate); `tick`: the 1 Hz dead-reckoning step; `camera`: a
   * throttled refilter while the map moves (perf M5: no position re-upload, no React counts);
   * `settle`: the camera stopped (counts published once).
   */
  const rebuild = useCallback(
    (kind: 'data' | 'tick' | 'camera' | 'settle') => {
      const f = frame.current;
      const globe = projection === 'globe';
      // The camera's ground point and altitude (pitch-aware), the same value the map host
      // publishes for isFacing(); null in mercator. Hides AND unpicks aircraft behind the limb.
      const camera = globe ? (map ? cameraFromMap(map) : getFarSideCamera()) : null;
      const now = Date.now();
      advanceFrame(f, now, buckets, camera);
      const aggregate = globe && f.count > AGGREGATE_ABOVE && view.current.zoom < AGGREGATE_BELOW_ZOOM;
      if (!aggregate) cells.current = null;
      else if (kind === 'data' || !cells.current) cells.current = aggregateH3(f);
      // Positions are re-uploaded only when time advanced (tick/data); a camera move re-runs the
      // per-aircraft accessors only when the visible set changed (visVersion) or the bearing did.
      if (kind === 'data' || kind === 'tick') tick.current++;
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
          now,
          camera,
          cells: cells.current,
          toSelection: aircraftSelection,
        }),
      );
      if (kind === 'camera') return; // counts reach React on settled changes only
      setDrawn(f.count);
      setTrailVertices(f.trailVertices);
      // The far-side camera (ground lng, lat, altitude m) the drawn count was filtered with (e2e).
      setCameraAttr(camera ? `${camera.lng.toFixed(3)},${camera.lat.toFixed(3)},${Math.round(camera.altitude)}` : '');
      setStale(f.staleVisible);
      const by = countStaleByBucket(f.seen, f.bucket, Date.now());
      const key = staleKey(by);
      if (key !== staleByKey.current) {
        staleByKey.current = key;
        setStaleBy(by);
      }
    },
    [map, projection, buckets, colorMode, theme, watched, tracks, selectedId],
  );

  // New snapshot → fresh typed arrays (re-aggregate once per snapshot, not per tick).
  useEffect(() => {
    frame.current = newFrame(data?.records ?? []);
    dataVersion.current++;
    rebuild('data');
  }, [data, rebuild]);

  // 1 Hz dead-reckoning on wall-clock second boundaries (one redraw per second shared with other
  // second-aligned layers, perf m-f), paused while the tab is hidden.
  useEffect(() => {
    const step = () => {
      if (!document.hidden) rebuild('tick');
    };
    let id: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      step();
      id = setInterval(step, TICK_MS);
    }, TICK_MS - (Date.now() % TICK_MS));
    return () => {
      clearTimeout(start);
      if (id) clearInterval(id);
    };
  }, [rebuild]);

  // Camera moves: far-side filter, icon scale and bearing compensation, at most CAMERA_REBUILD_MS
  // apart while moving (perf M5: was every animation frame) and once more when the camera settles.
  useEffect(() => {
    if (!map) return;
    let pending: ReturnType<typeof setTimeout> | undefined;
    let last = 0;
    const read = (kind: 'camera' | 'settle') => {
      const c = map.getCenter();
      view.current = { center: [c.lng, c.lat], zoom: map.getZoom(), bearing: map.getBearing() };
      last = Date.now();
      rebuild(kind);
    };
    const onMove = () => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = undefined;
        read('camera');
      }, Math.max(0, CAMERA_REBUILD_MS - (Date.now() - last)));
    };
    const onEnd = () => {
      if (pending) clearTimeout(pending);
      pending = undefined;
      read('settle');
    };
    read('settle');
    map.on('move', onMove);
    map.on('moveend', onEnd);
    return () => {
      map.off('move', onMove);
      map.off('moveend', onEnd);
      if (pending) clearTimeout(pending);
    };
  }, [map, rebuild]);

  // CPU hit-test (projected positions, nearest within HIT_PX) for the map's single click router:
  // works on the globe and in 2D regardless of GPU picking support.
  useEffect(() => registerHitTester('aviation', (point, m) => hitTestAircraft(frame.current, point, m)), []);

  useDeckLayers('aviation', layers, Z);

  // Rail status per active layer (honest SOURCE OFFLINE with last-good time on 503). The state is
  // never LIVE when most of the layer's positions are past the 60 s cap (MAJOR-C); the rail shows
  // "N OLDER THAN 60 S" from staleCount as the reason.
  useEffect(() => {
    for (const [bucket, id] of Object.entries(BUCKET_LAYER) as [Bucket, LayerId][]) {
      if (!active.has(id)) continue;
      if (!data) {
        updateStatus(id, { state: 'loading' });
        continue;
      }
      const total = data.offline ? 0 : data.counts[bucket];
      const staleCount = data.offline ? 0 : (staleBy?.[bucket] ?? 0);
      // Hysteresis on the stale share so the LED does not flap around 50 % between polls.
      const prevOwn = ownState.current[bucket] ?? null;
      ownState.current[bucket] = stalenessState(total, staleCount, prevOwn);
      updateStatus(id, {
        state: deriveLayerState(data.meta.state, total, staleCount, prevOwn),
        staleCount,
        count: data.offline ? null : data.counts[bucket],
        fetchedAt: data.meta.fetchedAt,
        observedAt: data.meta.observedAt,
        lastGoodAt: data.meta.lastGoodAt,
        providers: data.providers,
        ...(data.offline ? { error: 'SOURCE OFFLINE' } : {}),
      });
    }
  }, [data, active, staleBy, updateStatus]);

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
    <p className="sr-only" aria-live="polite" data-testid="aviation-status" data-map-ready={map ? '1' : '0'} data-drawn={drawn} data-trail-vertices={trailVertices} data-camera={cameraAttr} data-stale={stale} data-total={data?.counts.total ?? 0} data-offline={data?.offline ? '1' : '0'}>
      {selectedLabel !== null ? `Selected aircraft ${selectedLabel}` : ''}
    </p>
  );
}
