/**
 * Satellite propagation worker (satellite.js 7.1 SGP4 from OMM JSON via json2satrec). Keeps the
 * satrecs off the main thread and posts compacted typed arrays (transferred, not copied) at 1 Hz
 * (0.5 Hz under reduced motion or while the tab is hidden the main thread simply stops ticking).
 * Positions are propagated from published elements — never observed. Owner: layers-space.
 *
 * Protocol (main → worker):
 *   {type:'catalogue', version, rows}     rows = SATELLITE_FIELDS tuples (served by /api/satellites)
 *   {type:'view', center, visible, palette, selectedId}
 *   {type:'tick', at}                     propagate for `at` (ms) and post one frame
 * (worker → main):
 *   {type:'frame', version, at, count, positions, colors, radii, index, hidden, failed, selected}
 *   {type:'loaded', version, total, unusable}
 */
import type { SatRec } from 'satellite.js';
import { COL, SAT_CATEGORIES, recordToOmm, rowToRecord } from '@/features/space/lib/catalog';
import { satrecFromOmm } from '@/features/space/lib/orbit';
import { propagateBatch, type BatchOptions } from '@/features/space/lib/propagate-batch';

export type WorkerIn =
  | { type: 'catalogue'; version: string; rows: unknown[][] }
  | { type: 'view'; center: [number, number] | null; visible: number[]; palette: [number, number, number, number][]; selectedId: number | null }
  | { type: 'tick'; at: number };

interface Catalogue {
  version: string;
  satrecs: (SatRec | null)[];
  noradIds: Int32Array;
  categories: Uint8Array;
}

let catalogue: Catalogue | null = null;
let view: Omit<BatchOptions, 'at'> = { palette: [], visible: new Set(), center: null, selectedId: null };

const ctx = self as unknown as {
  postMessage: (msg: unknown, transfer?: Transferable[]) => void;
  onmessage: ((e: MessageEvent<WorkerIn>) => void) | null;
};

function load(version: string, rows: unknown[][]): void {
  const satrecs: (SatRec | null)[] = new Array(rows.length);
  const noradIds = new Int32Array(rows.length);
  const categories = new Uint8Array(rows.length);
  let unusable = 0;
  for (let i = 0; i < rows.length; i++) {
    const rec = rowToRecord(rows[i]!);
    noradIds[i] = rec.noradId;
    const c = SAT_CATEGORIES.indexOf(rows[i]![COL.category] as (typeof SAT_CATEGORIES)[number]);
    categories[i] = c < 0 ? SAT_CATEGORIES.length - 1 : c;
    satrecs[i] = satrecFromOmm(recordToOmm(rec));
    if (!satrecs[i]) unusable++;
  }
  catalogue = { version, satrecs, noradIds, categories };
  ctx.postMessage({ type: 'loaded', version, total: rows.length, unusable });
}

ctx.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'catalogue') load(msg.version, msg.rows);
  else if (msg.type === 'view') view = { center: msg.center, visible: new Set(msg.visible), palette: msg.palette, selectedId: msg.selectedId };
  else if (msg.type === 'tick' && catalogue) {
    const r = propagateBatch(catalogue, { ...view, at: msg.at });
    ctx.postMessage({ type: 'frame', version: catalogue.version, ...r }, [r.positions.buffer, r.colors.buffer, r.radii.buffer, r.index.buffer]);
  }
};
