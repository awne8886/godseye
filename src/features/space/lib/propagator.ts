/**
 * The tle-propagate worker's logic, separated from the worker global so it can be unit-tested.
 * The worker fetches and parses /api/satellites itself, builds the satrecs, and answers the main
 * thread with a small summary plus a packed catalogue whose typed arrays are TRANSFERRED — the
 * main thread never parses or structured-clones the ~3 MB catalogue. Positions are propagated
 * (SGP4) from the published elements, never observed. Owner: layers-space.
 *
 * Protocol (main → worker):
 *   {type:'load', url}                       fetch + parse + build (initial load and every refresh)
 *   {type:'view', camera, visible, palette, selectedId}   re-filters the newest propagation at once
 *   {type:'camera', camera}                  far-side camera only (throttled while the map moves);
 *                                            re-filters the newest propagation (no SGP4) and posts it
 *   {type:'tick', at}                        propagate for `at` (ms) and post one frame
 * (worker → main):
 *   {type:'catalogue', version, summary, packed | null}   packed null = same version, nothing rebuilt
 *   {type:'catalogue-error', status, meta, providers}      503 = SOURCE OFFLINE with last-good meta
 *   {type:'frame', version, at, count, positions, colors, sizes, index, categoryOffsets,
 *                                            hidden, failed, selected, camera}  rows sorted by category
 */
import type { SatRec } from 'satellite.js';
import type { FeedMeta, Mission, Providers, SatCategory } from '@/lib/types';
import { recordToOmm, rowToRecord } from './catalog';
import { satrecFromOmm } from './orbit';
import { packRows, packedTransferables, type PackedCatalogue } from './packed';
import { compactFrame, propagateVisible, type BatchOptions, type BatchResult, type FarSideCamera, type Propagated } from './propagate-batch';

export type WorkerIn =
  | { type: 'load'; url: string }
  | { type: 'view'; camera: FarSideCamera | null; visible: number[]; palette: [number, number, number, number][]; selectedId: number | null }
  | { type: 'camera'; camera: FarSideCamera | null }
  | { type: 'tick'; at: number };

/** Everything the main thread needs about the catalogue except the rows themselves. */
export interface CatalogueSummary {
  meta: FeedMeta;
  providers: Providers;
  categoryCounts: Record<SatCategory, number>;
  missions: Mission[];
  catalogueSource: 'celestrak' | 'satnogs-fallback';
  note?: string;
  total: number;
  /** Rows whose elements SGP4 rejects (never drawn, never guessed). */
  unusable: number;
}

export type WorkerOut =
  | { type: 'catalogue'; version: string; summary: CatalogueSummary; packed: PackedCatalogue | null }
  | { type: 'catalogue-error'; status: number; meta: FeedMeta | null; providers: Providers | null }
  | ({ type: 'frame'; version: string } & BatchResult);

export type Post = (msg: WorkerOut, transfer?: Transferable[]) => void;
export type FetchLike = (url: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

interface Loaded {
  version: string;
  satrecs: (SatRec | null)[];
  noradIds: Int32Array;
  categories: Uint8Array;
}

interface SatellitesBody {
  rows?: unknown[][];
  meta?: FeedMeta;
  providers?: Providers;
  categoryCounts?: Record<SatCategory, number>;
  missions?: Mission[];
  catalogueSource?: 'celestrak' | 'satnogs-fallback';
  note?: string;
}

export function createPropagator(post: Post, fetchImpl: FetchLike) {
  let loaded: Loaded | null = null;
  let view: Omit<BatchOptions, 'at'> = { palette: [], visible: new Set(), camera: null, selectedId: null };
  /** The newest propagation of `loaded` (re-filtered on camera moves without running SGP4 again). */
  let last: Propagated | null = null;
  let loading: Promise<void> | null = null;

  function postFrame(prop: Propagated): void {
    if (!loaded) return;
    const r = compactFrame(loaded, prop, view);
    post({ type: 'frame', version: loaded.version, ...r }, [r.positions.buffer, r.colors.buffer, r.sizes.buffer, r.index.buffer, r.categoryOffsets.buffer] as ArrayBuffer[]);
  }

  async function load(url: string): Promise<void> {
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await fetchImpl(url, { headers: { accept: 'application/json' } });
    } catch {
      post({ type: 'catalogue-error', status: 0, meta: null, providers: null });
      return;
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as SatellitesBody | null;
      post({ type: 'catalogue-error', status: res.status, meta: body?.meta ?? null, providers: body?.providers ?? null });
      return;
    }
    const body = (await res.json().catch(() => null)) as SatellitesBody | null;
    if (!body || !Array.isArray(body.rows) || !body.meta) {
      post({ type: 'catalogue-error', status: res.status, meta: body?.meta ?? null, providers: body?.providers ?? null });
      return;
    }
    const rows = body.rows;
    const version = `${body.meta.fetchedAt}|${rows.length}`;
    const summaryBase = {
      meta: body.meta,
      providers: body.providers ?? {},
      categoryCounts: body.categoryCounts ?? ({} as Record<SatCategory, number>),
      missions: body.missions ?? [],
      catalogueSource: body.catalogueSource ?? 'celestrak',
      ...(body.note ? { note: body.note } : {}),
      total: rows.length,
    } as const;
    if (loaded && loaded.version === version) {
      const unusable = loaded.satrecs.reduce((a, s) => a + (s ? 0 : 1), 0);
      post({ type: 'catalogue', version, summary: { ...summaryBase, unusable }, packed: null });
      return;
    }
    const packed = packRows(rows);
    const satrecs: (SatRec | null)[] = new Array(rows.length);
    let unusable = 0;
    for (let i = 0; i < rows.length; i++) {
      const s = satrecFromOmm(recordToOmm(rowToRecord(rows[i]!)));
      satrecs[i] = s;
      if (!s) unusable++;
    }
    // The worker keeps its own copies of the arrays it propagates from; the packed ones are transferred.
    loaded = { version, satrecs, noradIds: packed.noradIds.slice(), categories: packed.categories.slice() };
    last = null; // its rows index the previous catalogue
    post({ type: 'catalogue', version, summary: { ...summaryBase, unusable }, packed }, packedTransferables(packed));
  }

  return {
    handle(msg: WorkerIn): Promise<void> | void {
      if (msg.type === 'load') {
        // One load at a time; a refresh that arrives mid-load waits for it.
        const run = (loading ?? Promise.resolve()).then(() => load(msg.url));
        loading = run.finally(() => {
          if (loading === run) loading = null;
        });
        return run;
      }
      if (msg.type === 'view' || msg.type === 'camera') {
        view = msg.type === 'view' ? { camera: msg.camera, visible: new Set(msg.visible), palette: msg.palette, selectedId: msg.selectedId } : { ...view, camera: msg.camera };
        // The camera moved (or the view changed): nothing behind the globe may stay drawn until the
        // next tick, so the newest propagation is re-filtered now. A category switched on appears
        // with the next tick (its satellites were not propagated).
        if (last) postFrame(last);
        return;
      }
      if (msg.type === 'tick' && loaded) {
        // Propagates into the previous tick's buffers (no per-tick allocation for SGP4 output).
        last = propagateVisible(loaded, { ...view, at: msg.at }, last);
        postFrame(last);
      }
    },
    /** Test hook. */
    loadedVersion: () => loaded?.version ?? null,
  };
}
