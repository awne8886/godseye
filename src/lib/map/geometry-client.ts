/**
 * Main-thread client for the geometry worker: request/response by id, one worker per page.
 * Falls back to computing in-thread (same pure handler) if a module worker cannot start or dies.
 * Owner: map-engine.
 */
import type { LngLatTuple } from '@/lib/geo';
import { type GeometryRequest, type GeometryResponse, type TerminatorBands, handleGeometryRequest } from './geometry-protocol';

type Distribute<T> = T extends unknown ? Omit<T, 'id'> : never;
type RequestBody = Distribute<GeometryRequest>;

export interface GeometryPort {
  postMessage: (m: GeometryRequest) => void;
  onmessage: ((e: MessageEvent<GeometryResponse>) => void) | null;
  onerror?: ((e: unknown) => void) | null;
  terminate?: () => void;
}

export function createGeometryClient(spawn: () => GeometryPort | null) {
  let port: GeometryPort | null | undefined;
  let seq = 0;
  const pending = new Map<number, (r: GeometryResponse) => void>();

  const start = () => {
    if (port !== undefined) return port;
    try {
      port = spawn();
    } catch {
      port = null;
    }
    if (port) {
      port.onmessage = (e) => {
        const resolve = pending.get(e.data.id);
        if (!resolve) return;
        pending.delete(e.data.id);
        resolve(e.data);
      };
      port.onerror = () => {
        // The worker died: fail everything in flight (callers recompute in-thread) and stop using it.
        port?.terminate?.();
        port = null;
        for (const [id, resolve] of pending) resolve({ id, type: 'error', message: 'geometry worker failed' });
        pending.clear();
      };
    }
    return port;
  };

  const request = (body: RequestBody): Promise<GeometryResponse> => {
    const req = { ...body, id: ++seq } as GeometryRequest;
    const w = start();
    if (!w) return Promise.resolve(handleGeometryRequest(req));
    return new Promise((resolve) => {
      pending.set(req.id, resolve);
      w.postMessage(req);
    });
  };

  const local = (body: RequestBody) => handleGeometryRequest({ ...body, id: 0 } as GeometryRequest);

  return {
    async terminator(at: number, stepDeg = 2): Promise<TerminatorBands> {
      let r = await request({ type: 'terminator', at, stepDeg });
      if (r.type === 'error') r = local({ type: 'terminator', at, stepDeg });
      if (r.type === 'terminator') return r.bands;
      throw new Error(r.type === 'error' ? r.message : 'unexpected geometry response');
    },
    async greatCircle(from: LngLatTuple, to: LngLatTuple, points = 128): Promise<LngLatTuple[]> {
      let r = await request({ type: 'greatCircle', from, to, points });
      if (r.type === 'error' && r.message === 'geometry worker failed') r = local({ type: 'greatCircle', from, to, points });
      if (r.type === 'greatCircle') return r.points;
      throw new Error(r.type === 'error' ? r.message : 'unexpected geometry response');
    },
    /** One night-lights tile, computed in the worker (rejects when the worker is unavailable or the tile fails). */
    nightTile(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
      const w = start();
      if (!w) return Promise.reject(new Error('geometry worker unavailable'));
      if (signal.aborted) return Promise.reject(signal.reason);
      const id = ++seq;
      return new Promise<ArrayBuffer>((resolve, reject) => {
        const onAbort = () => {
          pending.delete(id);
          w.postMessage({ id: ++seq, type: 'abort', target: id });
          reject(signal.reason);
        };
        signal.addEventListener('abort', onAbort, { once: true });
        pending.set(id, (r) => {
          signal.removeEventListener('abort', onAbort);
          if (r.type === 'nightTile') resolve(r.data);
          else reject(new Error(r.type === 'error' ? r.message : 'unexpected geometry response'));
        });
        w.postMessage({ id, type: 'nightTile', url });
      });
    },
    /** True when a worker is running (or can be started). */
    hasWorker: () => !!start(),
    dispose() {
      port?.terminate?.();
      port = undefined;
      pending.clear();
    },
  };
}

let shared: ReturnType<typeof createGeometryClient> | null = null;

/** The page-wide geometry client (browser only). */
export function geometryClient() {
  shared ??= createGeometryClient(() =>
    typeof Worker === 'undefined'
      ? null
      : (new Worker(new URL('../../workers/geometry.ts', import.meta.url), { type: 'module', name: 'godseye-geometry' }) as unknown as GeometryPort),
  );
  return shared;
}
