/**
 * The camera point layer and its pick mapping, as pure functions (SurveillanceLayer supplies the
 * camera-facing rows, the `--map-cctv` colours with their trigger key and the zoom band). On the globe the points draw with
 * `cullMode: 'none'` + `depthCompare: 'always'` (CCTV_POINT_PARAMETERS) so the surface never
 * half-clips a disc; `rows` must therefore already be far-side filtered (./far-side.ts), and the
 * pick mapping refuses a camera behind the limb. Owner: layers-surveillance.
 */
import { ScatterplotLayer } from '@deck.gl/layers';
import type { Cell } from '@/lib/columnar';
import type { Selection } from '@/lib/layer-host';
import { isFacing, type FarSideCamera } from '@/lib/map/far-side';
import type { Rgba } from '@/lib/tokens';
import { CCTV_ZOOM_BANDS } from '../shared';
import { CCTV_POINT_PARAMETERS } from './far-side';
import { IDX, rowToCamera } from './rows';

export const CCTV_DECK_ID = 'surveillance-cctv';

export interface CameraPointColors {
  /** Video (HLS / latest clip) fill and every stroke. */
  live: Rgba;
  still: Rgba;
  /** Link-out-only cameras. */
  link: Rgba;
}

const isVideo = (r: readonly Cell[]) => r[IDX.streamType] === 'hls' || r[IDX.streamType] === 'mp4';

/**
 * One ScatterplotLayer over the (camera-facing) columnar rows, styled for the zoom `band`.
 * `colorKey` must change whenever `colors` may have (theme preset, Style Studio, Ghost Protocol:
 * see colorKeyOf): deck re-runs the colour accessors on the same `rows` only when it does.
 */
export function cameraPointsLayer(rows: readonly Cell[][], colors: CameraPointColors, band: number, colorKey: string): ScatterplotLayer<Cell[]> {
  const style = CCTV_ZOOM_BANDS[Math.max(0, Math.min(CCTV_ZOOM_BANDS.length - 1, band))]!;
  return new ScatterplotLayer<Cell[]>({
    id: CCTV_DECK_ID,
    data: rows as Cell[][],
    getPosition: (r) => [r[IDX.lng] as number, r[IDX.lat] as number],
    getRadius: (r) => (isVideo(r) ? 4 : 3),
    radiusUnits: 'pixels',
    radiusScale: style.scale,
    radiusMinPixels: 0.75,
    radiusMaxPixels: style.maxPx,
    opacity: style.opacity,
    getFillColor: (r) => (r[IDX.streamType] === 'link' ? colors.link : isVideo(r) ? colors.live : colors.still),
    stroked: style.stroked,
    getLineColor: (r) => (r[IDX.streamType] === 'link' ? colors.still : colors.live),
    lineWidthUnits: 'pixels',
    getLineWidth: 0.75,
    pickable: true,
    autoHighlight: true,
    // Flat discs on the globe: never depth-clipped by the surface; the far side is filtered out of `rows`.
    parameters: CCTV_POINT_PARAMETERS,
    updateTriggers: { getFillColor: colorKey, getLineColor: colorKey },
  });
}

/** The colour trigger for a theme preset and a style version (useStyleVersion()). */
export const colorKeyOf = (theme: string, styleVersion: number): string => `${theme}:${styleVersion}`;

/** Card selection for a picked camera row; null for anything else or a camera behind the limb. */
export function cameraSelection(object: unknown, camera: FarSideCamera | null): Selection | null {
  if (!Array.isArray(object)) return null;
  const c = rowToCamera(object as Cell[]);
  if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng) || !isFacing([c.lng, c.lat], camera)) return null;
  return { kind: 'camera', id: c.id, layer: 'cctv', source: c.source, observedAt: c.observedAt, data: c as unknown as Record<string, unknown>, lngLat: [c.lng, c.lat] };
}
