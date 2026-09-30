/**
 * Server-side lookups over the cached satellite catalogue (orbit tracks, the ISS ground track).
 * Never fetches: reads the satellites feed snapshot. Server-only. Owner: layers-space.
 */
import 'server-only';
import type { SatRec } from 'satellite.js';
import { recordToOmm, rowToRecord, COL, type SatRecord, type SatRow } from '../lib/catalog';
import { satrecFromOmm } from '../lib/orbit';
import type { SatCatalogue } from './satellites';

interface Index {
  rows: SatRow[];
  byId: Map<number, SatRow>;
  satrecs: Map<number, SatRec | null>;
}

let index: Index | null = null;

function indexFor(cat: SatCatalogue): Index {
  if (index && index.rows === cat.rows) return index;
  const byId = new Map<number, SatRow>();
  for (const r of cat.rows) byId.set(r[COL.noradId] as number, r);
  index = { rows: cat.rows, byId, satrecs: new Map() };
  return index;
}

/** The record and its satrec for a NORAD id, or null when not in the catalogue / not propagatable. */
export function lookupSatellite(cat: SatCatalogue, noradId: number): { record: SatRecord; satrec: SatRec | null } | null {
  const idx = indexFor(cat);
  const row = idx.byId.get(noradId);
  if (!row) return null;
  const record = rowToRecord(row);
  if (!idx.satrecs.has(noradId)) idx.satrecs.set(noradId, satrecFromOmm(recordToOmm(record)));
  return { record, satrec: idx.satrecs.get(noradId) ?? null };
}
