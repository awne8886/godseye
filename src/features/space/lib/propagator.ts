/**
 * The tle-propagate worker's logic, separated from the worker global so it can be unit-tested.
 * The worker fetches and parses /api/satellites itself, builds the satrecs, and answers the main
 * thread with a small summary plus a packed catalogue whose typed arrays are TRANSFERRED — the
 * main thread never parses or structured-clones the ~3 MB catalogue. Positions are propagated
 * (SGP4) from the published elements, never observed. Owner: layers-space.
 *
 * Protocol (main → worker):
 *   {type:'load', url}                       fetch + parse + build (initial load and every refresh)
 *   {type:'view', center, visible, palette, selectedId}
 *   {type:'tick', at}                        propagate for `at` (ms) and post one frame
 * (worker → main):
 *   {type:'catalogue', version, summary, packed | null}   packed null = same version, nothing rebuilt
 *   {type:'catalogue-error', status, meta, providers}      503 = SOURCE OFFLINE with last-good meta
 *   {type:'frame', version, at, count, positions, colors, radii, index, hidden, failed, selected}
 */
import type { SatRec } from 'satellite.js';
import type { FeedMeta, Mission, Providers, SatCategory } from '@/lib/types';
import { recordToOmm, rowToRecord } from './catalog';
import { satrecFromOmm } from './orbit';
import { packRows, packedTransferables, type PackedCatalogue } from './packed';
import { propagateBatch, type BatchOptions, type BatchResult } from './propagate-batch';

export type WorkerIn =
  | { type: 'load'; url: string }
  | { type: 'view'; center: [number, number] | null; visible: number[]; palette: [number, number, number, number][]; selectedId: number | null }
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
  let view: Omit<BatchOptions, 'at'> = { palette: [], visible: new Set(), center: null, selectedId: null };
  let loading: Promise<void> | null = null;

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
      if (msg.type === 'view') {
        view = { center: msg.center, visible: new Set(msg.visible), palette: msg.palette, selectedId: msg.selectedId };
        return;
      }
      if (msg.type === 'tick' && loaded) {
        const r = propagateBatch(loaded, { ...view, at: msg.at });
        post({ type: 'frame', version: loaded.version, ...r }, [r.positions.buffer, r.colors.buffer, r.radii.buffer, r.index.buffer] as ArrayBuffer[]);
      }
    },
    /** Test hook. */
    loadedVersion: () => loaded?.version ?? null,
  };
}
