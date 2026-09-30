/**
 * Satellite propagation worker (satellite.js 7.1 SGP4 from OMM JSON via json2satrec). It fetches
 * and parses /api/satellites itself, keeps the satrecs off the main thread and posts compacted
 * typed arrays (transferred, not copied) once per main-thread tick (1 Hz; 0.5 Hz under reduced
 * motion; no ticks while the tab is hidden). The protocol lives in
 * `src/features/space/lib/propagator.ts`. Positions are propagated from published elements —
 * never observed. Owner: layers-space.
 */
import { createPropagator, type Post, type WorkerIn } from '@/features/space/lib/propagator';

const ctx = self as unknown as {
  postMessage: (msg: unknown, transfer?: Transferable[]) => void;
  onmessage: ((e: MessageEvent<WorkerIn>) => void) | null;
};

const post: Post = (msg, transfer) => ctx.postMessage(msg, transfer ?? []);
const propagator = createPropagator(post, (url, init) => fetch(url, init));

ctx.onmessage = (e) => {
  void propagator.handle(e.data);
};

export type { WorkerIn, WorkerOut } from '@/features/space/lib/propagator';
