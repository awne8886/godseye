/**
 * Typed message contract for the geometry worker (src/workers/geometry.ts) and the pure handler
 * it runs. The same handler runs in-thread when module workers are unavailable, so the map never
 * shows a different (or fabricated) terminator. Owner: map-engine. Pure and unit-tested.
 */
import { greatCirclePoints, type LngLatTuple } from '@/lib/geo';
import { terminatorBands } from '@/lib/solar';

export type TerminatorBands = ReturnType<typeof terminatorBands>;

export type GeometryRequest =
  | { id: number; type: 'terminator'; at: number; stepDeg?: number }
  | { id: number; type: 'greatCircle'; from: LngLatTuple; to: LngLatTuple; points?: number }
  /** A `godseye-night://z/x/y?t=` tile: fetched, clipped and PNG-encoded in the worker (async). */
  | { id: number; type: 'nightTile'; url: string }
  /** Cancel request `target` (MapLibre aborted the tile). */
  | { id: number; type: 'abort'; target: number };

export type GeometryResponse =
  | { id: number; type: 'terminator'; at: number; bands: TerminatorBands }
  | { id: number; type: 'greatCircle'; points: LngLatTuple[] }
  | { id: number; type: 'nightTile'; data: ArrayBuffer }
  | { id: number; type: 'error'; message: string };

/** Twilight polygons are recomputed on this cadence (the sun moves 0.25° per minute). */
export const TERMINATOR_REFRESH_MS = 60_000;

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const lngLat = (p: unknown): p is LngLatTuple => Array.isArray(p) && p.length === 2 && finite(p[0]) && finite(p[1]) && Math.abs(p[1]) <= 90;

export function handleGeometryRequest(req: GeometryRequest): GeometryResponse {
  const id = finite(req?.id) ? req.id : -1;
  try {
    switch (req?.type) {
      case 'terminator': {
        if (!finite(req.at)) throw new Error('terminator: `at` must be a finite epoch ms');
        const step = finite(req.stepDeg) ? Math.min(10, Math.max(0.25, req.stepDeg)) : 2;
        return { id, type: 'terminator', at: req.at, bands: terminatorBands(req.at, step) };
      }
      case 'greatCircle': {
        if (!lngLat(req.from) || !lngLat(req.to)) throw new Error('greatCircle: from/to must be [lng, lat]');
        const n = finite(req.points) ? Math.min(1024, Math.max(2, Math.floor(req.points))) : 128;
        return { id, type: 'greatCircle', points: greatCirclePoints(req.from, req.to, n) };
      }
      case 'nightTile':
      case 'abort':
        throw new Error(`${req.type} is handled asynchronously by the worker`);
      default:
        throw new Error(`unknown geometry request: ${String((req as { type?: unknown } | null)?.type)}`);
    }
  } catch (e) {
    return { id, type: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}
