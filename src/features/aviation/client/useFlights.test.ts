import { describe, expect, it } from 'vitest';
import type { AdsbResponse } from '../adsb';
import { normalizeAdsbResponse } from '../adsb';
import { encodeFlight, F } from '../codec';
import point from '../__fixtures__/adsblol-point.json';
import { decodeRows } from './useFlights';

// Rows built from the recorded adsb.lol /v2/point fixture (2026-09-30, see `_captured`).
const records = normalizeAdsbResponse(point as AdsbResponse, 'adsblol_tiles', point.now).records;
const sources = ['adsblol_tiles'];
const rows = () => records.map((r) => encodeFlight(r, 0));

describe('decodeRows (perf M4: one poll does not allocate per unchanged aircraft)', () => {
  it('reuses the previous record object for every unchanged row', () => {
    const first = decodeRows(rows(), sources, null);
    const byId = new Map(first.map((r) => [r.id, r]));
    const second = decodeRows(rows(), sources, byId);
    expect(second).toHaveLength(first.length);
    expect(second.every((r, i) => r === first[i])).toBe(true);
  });

  it('decodes a fresh object only for re-observed aircraft', () => {
    const first = decodeRows(rows(), sources, null);
    const byId = new Map(first.map((r) => [r.id, r]));
    const next = rows();
    next[0]![F.seenAt] = (next[0]![F.seenAt] as number) + 5; // a new observation
    const second = decodeRows(next, sources, byId);
    expect(second[0]).not.toBe(first[0]);
    expect(second[0]!.seenAt).toBe(first[0]!.seenAt + 5);
    expect(second.slice(1).every((r, i) => r === first[i + 1])).toBe(true);
  });
});
