/**
 * Packed satellite catalogue: what the propagation worker hands the main thread instead of the
 * parsed /api/satellites rows. Typed arrays (transferred, zero-copy) plus ONE string holding the
 * card text fields, so the main thread never parses the ~3 MB JSON nor structured-clones 16k
 * nested arrays. Card look-ups slice the string on demand. Pure and isomorphic. Owner: layers-space.
 */
import type { SatCategory } from '@/lib/types';
import { COL, SAT_CATEGORIES } from './catalog';

/** The fields a satellite card / selection needs (a subset of SatRecord). */
export interface CardRecord {
  noradId: number;
  name: string;
  objectId: string;
  /** Element-set epoch, ISO-8601 UTC as served. */
  epoch: string;
  meanMotion: number;
  eccentricity: number;
  inclination: number;
  category: SatCategory;
  missionIndex: number;
}

export interface PackedCatalogue {
  count: number;
  noradIds: Int32Array;
  /** SAT_CATEGORIES index per row. */
  categories: Uint8Array;
  missionIndex: Uint16Array;
  /** [meanMotion, eccentricity, inclination] per row. */
  elements: Float64Array;
  /** name, objectId, epoch of every row, concatenated. */
  text: string;
  /** Start offset of each text field (3 per row) plus the final end: length 3·count + 1. */
  textOffsets: Uint32Array;
}

const TEXT_FIELDS = [COL.name, COL.objectId, COL.epoch] as const;

export function categoryIndex(c: unknown): number {
  const i = SAT_CATEGORIES.indexOf(c as SatCategory);
  return i < 0 ? SAT_CATEGORIES.length - 1 : i;
}

/** Pack served rows (SATELLITE_FIELDS tuples). Runs in the worker. */
export function packRows(rows: readonly (readonly unknown[])[]): PackedCatalogue {
  const n = rows.length;
  const noradIds = new Int32Array(n);
  const categories = new Uint8Array(n);
  const missionIndex = new Uint16Array(n);
  const elements = new Float64Array(n * 3);
  const textOffsets = new Uint32Array(n * 3 + 1);
  const parts: string[] = new Array(n * 3);
  let off = 0;
  for (let i = 0; i < n; i++) {
    const r = rows[i]!;
    noradIds[i] = r[COL.noradId] as number;
    categories[i] = categoryIndex(r[COL.category]);
    missionIndex[i] = (r[COL.missionIndex] as number) ?? 0;
    elements[i * 3] = r[COL.meanMotion] as number;
    elements[i * 3 + 1] = r[COL.eccentricity] as number;
    elements[i * 3 + 2] = r[COL.inclination] as number;
    for (let k = 0; k < 3; k++) {
      const v = r[TEXT_FIELDS[k]!];
      const s = typeof v === 'string' ? v : '';
      textOffsets[i * 3 + k] = off;
      parts[i * 3 + k] = s;
      off += s.length;
    }
  }
  textOffsets[n * 3] = off;
  return { count: n, noradIds, categories, missionIndex, elements, text: parts.join(''), textOffsets };
}

/** Buffers to list in postMessage's transfer argument. */
export function packedTransferables(p: PackedCatalogue): ArrayBuffer[] {
  return [p.noradIds.buffer, p.categories.buffer, p.missionIndex.buffer, p.elements.buffer, p.textOffsets.buffer] as ArrayBuffer[];
}

/** One row as a card record (sliced on demand; nothing is materialised up front). */
export function packedRecord(p: PackedCatalogue, i: number): CardRecord | null {
  if (!Number.isInteger(i) || i < 0 || i >= p.count) return null;
  const t = (k: number) => p.text.slice(p.textOffsets[i * 3 + k]!, p.textOffsets[i * 3 + k + 1]!);
  return {
    noradId: p.noradIds[i]!,
    name: t(0),
    objectId: t(1),
    epoch: t(2),
    meanMotion: p.elements[i * 3]!,
    eccentricity: p.elements[i * 3 + 1]!,
    inclination: p.elements[i * 3 + 2]!,
    category: SAT_CATEGORIES[p.categories[i]!] ?? 'other',
    missionIndex: p.missionIndex[i]!,
  };
}
