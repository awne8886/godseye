/**
 * Geometry module worker: twilight bands (civil/nautical/astronomical/night) every 60 s,
 * great-circle polylines, and the Black Marble night-lights tile pipeline (fetch, decode, per-pixel
 * night clip, PNG encode), all off the main thread. Spawned by src/lib/map/geometry-client.ts with
 * `new Worker(new URL('../../workers/geometry.ts', import.meta.url), {type: 'module'})`.
 * The message contract lives in src/lib/map/geometry-protocol.ts. Owner: map-engine.
 */
import { type GeometryRequest, type GeometryResponse, handleGeometryRequest } from '@/lib/map/geometry-protocol';
import { createBrowserNightLoader } from '@/lib/map/night-lights';

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<GeometryRequest>) => void) | null;
  postMessage: (m: GeometryResponse, transfer?: Transferable[]) => void;
};

let night: ReturnType<typeof createBrowserNightLoader> | null = null;
const inflight = new Map<number, AbortController>();

scope.onmessage = (e) => {
  const req = e.data;
  if (req?.type === 'abort') {
    inflight.get(req.target)?.abort(new DOMException('Tile no longer needed', 'AbortError'));
    return;
  }
  if (req?.type === 'nightTile') {
    night ??= createBrowserNightLoader();
    const ac = new AbortController();
    inflight.set(req.id, ac);
    night
      .load(req.url, ac.signal)
      .then(
        (data) => scope.postMessage({ id: req.id, type: 'nightTile', data }, [data]),
        (err: unknown) => scope.postMessage({ id: req.id, type: 'error', message: err instanceof Error ? err.message : String(err) }),
      )
      .finally(() => inflight.delete(req.id));
    return;
  }
  scope.postMessage(handleGeometryRequest(req));
};
