import { describe, expect, it } from 'vitest';
import { TrackPoint } from '@/lib/schemas/aviation';
import full from './__fixtures__/trace-full-4cafc4.json';
import recent from './__fixtures__/trace-recent-4cafc4.json';
import { currentLeg, downsample, latestSource, mergeTraces, parseTrace, toTrackPoints, type TraceFile, type TraceRow } from './trace';

// Fixtures: adsb.lol readsb traces for 4cafc4 captured 2026-09-30T18:07Z (thinned).
const row = (at: number, onGround: boolean, newLeg = false): TraceRow => ({ at, lat: 1, lng: 1, altFt: onGround ? null : 1000, onGround, gsKt: 100, trackDeg: 90, newLeg, source: 'adsb_icao' });

describe('readsb traces', () => {
  it('parses rows with absolute times, ground flags and sources', () => {
    const rows = parseTrace(full as TraceFile);
    expect(rows.length).toBeGreaterThan(50);
    expect(rows[0]!.at).toBe(Math.round(((full as TraceFile).timestamp! + (full.trace[0] as number[])[0]!) * 1000));
    expect(rows.some((r) => r.onGround)).toBe(true);
    expect(latestSource(rows)).toBe('adsb_icao');
    expect(parseTrace(null)).toEqual([]);
    expect(parseTrace({ timestamp: 1, trace: [[0, 'x', 1], 'junk', [1, 95, 1]] })).toEqual([]);
  });

  it('appends only the newer tail of trace_recent', () => {
    const f = parseTrace(full as TraceFile);
    const r = parseTrace(recent as TraceFile);
    const m = mergeTraces(f, r);
    expect(m.length).toBeGreaterThanOrEqual(f.length);
    for (let i = 1; i < m.length; i++) expect(m[i]!.at).toBeGreaterThan(m[i - 1]!.at);
  });

  it('splits the current leg on ≥ 4 consecutive ground samples', () => {
    const rows = [row(1, false), row(2, true), row(3, true), row(4, true), row(5, true), row(6, false), row(7, false), row(8, false)];
    const leg = currentLeg(rows);
    expect(leg.map((r) => r.at)).toEqual([5, 6, 7, 8]);
  });

  it('keeps the landing roll-out and ignores short ground blips', () => {
    const rows = [row(1, true), row(2, true), row(3, true), row(4, true), row(5, false), row(6, true), row(7, false), row(8, true), row(9, true)];
    expect(currentLeg(rows).map((r) => r.at)).toEqual([4, 5, 6, 7, 8, 9]);
  });

  it('honours the readsb new-leg flag', () => {
    const rows = [row(1, false), row(2, false), row(3, false, true), row(4, false)];
    expect(currentLeg(rows).map((r) => r.at)).toEqual([3, 4]);
  });

  it('returns every row when the leg would be a single point', () => {
    const rows = [row(1, false), row(2, true), row(3, true), row(4, true), row(5, true)];
    expect(currentLeg(rows)).toHaveLength(5);
  });

  it('downsamples to ≤ 700 keeping both endpoints', () => {
    const pts = Array.from({ length: 5000 }, (_, i) => i);
    const d = downsample(pts, 700);
    expect(d).toHaveLength(700);
    expect(d[0]).toBe(0);
    expect(d.at(-1)).toBe(4999);
    expect(downsample([1, 2, 3], 700)).toEqual([1, 2, 3]);
  });

  it('emits schema-valid track points (ground → null altitude)', () => {
    const pts = toTrackPoints(currentLeg(parseTrace(full as TraceFile)));
    for (const p of pts) expect(TrackPoint.safeParse(p).success).toBe(true);
    expect(pts.filter((p) => p.onGround).every((p) => p.altFt === null)).toBe(true);
  });
});
