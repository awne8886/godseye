/**
 * Geometry module worker: twilight bands (civil/nautical/astronomical/night) every 60 s and
 * great-circle polylines, off the main thread. Spawned by src/lib/map/geometry-client.ts with
 * `new Worker(new URL('../../workers/geometry.ts', import.meta.url), {type: 'module'})`.
 * The message contract lives in src/lib/map/geometry-protocol.ts. Owner: map-engine.
 */
import { type GeometryRequest, handleGeometryRequest } from '@/lib/map/geometry-protocol';

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<GeometryRequest>) => void) | null;
  postMessage: (m: unknown) => void;
};

scope.onmessage = (e) => {
  scope.postMessage(handleGeometryRequest(e.data));
};
