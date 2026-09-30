/**
 * Lazy 3D terrain (registry `terrain_elevation`): AWS Terrarium raster-dem that engages only at
 * z ≥ 10 after the camera has settled for 500 ms (tab visible), and releases below z 9.5
 * (hysteresis, so hovering around z 10 never thrashes tile loads). While attached, maxPitch is
 * capped at 60 and pixelRatio at 1.5; the host switches to mercator while terrain is engaged
 * (`onEngagedChange`) and draped layers are batched below overlays (terrain-layer-order.ts).
 * Port of the OSIRIS map-terrain.ts state machine. Owner: map-engine. Unit-tested with fake timers.
 */
import type { ErrorEvent, Map as MapLibreMap, MapSourceDataEvent } from 'maplibre-gl';
import { TERRAIN_SOURCE_ID, TERRARIUM_ATTRIBUTION, TERRARIUM_MAX_ZOOM, TERRARIUM_TILES } from './imagery';
import { batchTerrainLayers } from './terrain-layer-order';

export type TerrainStatus = 'idle' | 'waiting' | 'loading' | 'ready' | 'error';

export const TERRAIN_MIN_ZOOM = 10;
export const TERRAIN_RELEASE_ZOOM = 9.5;
export const TERRAIN_SETTLE_MS = 500;
export const TERRAIN_MAX_PITCH = 60;
export const TERRAIN_MAX_PIXEL_RATIO = 1.5;

/** The subset of the MapLibre Map the controller touches (a fake implements it in tests). */
export type TerrainMap = Pick<
  MapLibreMap,
  | 'getZoom'
  | 'isMoving'
  | 'getPixelRatio'
  | 'setPixelRatio'
  | 'addSource'
  | 'getSource'
  | 'removeSource'
  | 'setTerrain'
  | 'getTerrain'
  | 'getLayersOrder'
  | 'getLayer'
  | 'moveLayer'
  | 'on'
  | 'off'
  | 'setSourceTileLodParams'
>;

export interface TerrainOptions {
  onStatus?: (s: TerrainStatus) => void;
  /** Called with true just before terrain attaches and false after it detaches. */
  onEngagedChange?: (engaged: boolean) => void;
  isHidden?: () => boolean;
}

export function attachTerrain(map: TerrainMap, { onStatus, onEngagedChange, isHidden }: TerrainOptions = {}): () => void {
  let disposed = false;
  let active = false;
  let failed = false;
  let status: TerrainStatus | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let restoreOrder: (() => void) | undefined;
  let originalPixelRatio: number | null = null;
  const hidden = () => isHidden?.() ?? (typeof document !== 'undefined' && document.hidden);

  const report = (next: TerrainStatus) => {
    if (disposed || next === status) return;
    status = next;
    onStatus?.(next);
  };
  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const release = () => {
    if (!active) return;
    active = false;
    if (map.getTerrain()?.source === TERRAIN_SOURCE_ID) map.setTerrain(null);
    if (map.getSource(TERRAIN_SOURCE_ID)) map.removeSource(TERRAIN_SOURCE_ID);
    restoreOrder?.();
    restoreOrder = undefined;
    if (originalPixelRatio !== null) map.setPixelRatio(originalPixelRatio);
    originalPixelRatio = null;
    onEngagedChange?.(false);
  };
  const activate = () => {
    timer = undefined;
    if (disposed || active || failed || map.isMoving() || hidden() || map.getZoom() < TERRAIN_MIN_ZOOM) return;
    active = true;
    report('loading');
    try {
      onEngagedChange?.(true);
      const ratio = map.getPixelRatio();
      if (ratio > TERRAIN_MAX_PIXEL_RATIO) {
        originalPixelRatio = ratio;
        map.setPixelRatio(TERRAIN_MAX_PIXEL_RATIO);
      }
      map.addSource(TERRAIN_SOURCE_ID, {
        type: 'raster-dem',
        tiles: TERRARIUM_TILES,
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: TERRARIUM_MAX_ZOOM,
        attribution: TERRARIUM_ATTRIBUTION,
      });
      // The DEM maxzoom limits downloads, not render-tile density in a pitched view: bound that too.
      map.setSourceTileLodParams(TERRARIUM_MAX_ZOOM, 1.25, TERRAIN_SOURCE_ID);
      restoreOrder = batchTerrainLayers(map);
      map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration: 1 });
    } catch {
      failed = true;
      release();
      report('error');
    }
  };
  const update = () => {
    if (disposed || active || failed) return;
    cancel();
    if (map.getZoom() < TERRAIN_MIN_ZOOM) {
      report('idle');
      return;
    }
    report('waiting');
    if (!map.isMoving() && !hidden()) timer = setTimeout(activate, TERRAIN_SETTLE_MS);
  };
  const onZoom = () => {
    const z = map.getZoom();
    if (!active && z < TERRAIN_MIN_ZOOM) {
      cancel();
      if (!failed) report('idle');
    }
    // Stop terrain requests during the zoom-out, before the globe comes back.
    if (active && z < TERRAIN_RELEASE_ZOOM) {
      release();
      report('idle');
    }
  };
  const onData = (e: MapSourceDataEvent) => {
    if (active && !failed && e.sourceId === TERRAIN_SOURCE_ID && e.isSourceLoaded && (e.tile || e.sourceDataType === 'idle')) report('ready');
  };
  const onError = (e: ErrorEvent & { sourceId?: string }) => {
    if (!active || e.sourceId !== TERRAIN_SOURCE_ID) return;
    failed = true;
    report('error');
    // Let MapLibre finish its source callback before removing the source.
    queueMicrotask(() => {
      if (!disposed) release();
    });
  };
  const onVisibility = () => (hidden() ? cancel() : update());
  const onRemove = () => {
    disposed = true;
    cancel();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
  };

  map.on('movestart', cancel);
  map.on('zoom', onZoom);
  map.on('moveend', update);
  map.on('sourcedata', onData);
  map.on('error', onError);
  map.on('remove', onRemove);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
  report('idle');
  update();

  return () => {
    if (disposed) return;
    cancel();
    map.off('movestart', cancel);
    map.off('zoom', onZoom);
    map.off('moveend', update);
    map.off('sourcedata', onData);
    map.off('error', onError);
    map.off('remove', onRemove);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    release();
    disposed = true;
  };
}

/** Human status line for the terrain toggle (shown by the HUD). */
export const TERRAIN_STATUS_TEXT: Record<TerrainStatus, string> = {
  idle: 'Terrain at zoom 10+ · zoom in',
  waiting: 'Terrain starts when you stop moving',
  loading: 'Loading nearby terrain…',
  ready: 'Terrain on',
  error: 'Terrain unavailable; the map is still usable.',
};
