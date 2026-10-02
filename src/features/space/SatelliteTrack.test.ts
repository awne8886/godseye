import { describe, expect, it } from 'vitest';
import { compass, passLines } from './SatelliteTrack';

describe('satellite TRACK tab wording', () => {
  it('words a predicted pass with its step precision and direction', () => {
    const lines = passLines({
      kind: 'pass',
      inProgress: false,
      pass: { aosMs: Date.parse('2026-09-30T19:41:30Z'), maxMs: Date.parse('2026-09-30T19:44:30Z'), maxElevationDeg: 47.6, aosAzimuthDeg: 262, losMs: Date.parse('2026-09-30T19:48:00Z') },
    });
    expect(lines).toEqual([
      { label: 'RISES (±30 S)', value: '09-30 19:41:30Z · W' },
      { label: 'MAX ELEVATION', value: '48° · 19:44:30Z' },
      { label: 'SETS (±30 S)', value: '19:48:00Z' },
    ]);
  });

  it('words an in-progress pass by its predicted rise, or as up now when no rise was predicted', () => {
    const pass = { aosMs: Date.parse('2026-09-30T19:41:30Z'), maxMs: Date.parse('2026-09-30T19:44:30Z'), maxElevationDeg: 47.6, aosAzimuthDeg: 262, losMs: Date.parse('2026-09-30T19:48:00Z') };
    const rose = passLines({ kind: 'pass', inProgress: true, pass });
    expect(rose).not.toBeTypeOf('string');
    expect((rose as { label: string }[])[0]).toEqual({ label: 'ROSE (±30 S)', value: '09-30 19:41:30Z · W' });
    const now = passLines({ kind: 'pass', inProgress: true, pass: { ...pass, aosMs: null, aosAzimuthDeg: null } });
    expect((now as { label: string; value: string }[])[0]).toEqual({ label: 'ABOVE 10° NOW', value: 'RISE NOT PREDICTED' });
  });

  it('never invents a pass', () => {
    expect(passLines({ kind: 'none' })).toBe('NO PASS ABOVE 10° IN THE NEXT 24 H');
    expect(passLines({ kind: 'always-up' })).toBe('ABOVE 10° FOR THE WHOLE NEXT 24 H');
    expect(passLines({ kind: 'unpropagatable' })).toMatch(/NO PASS PREDICTION/);
    expect([0, 22, 23, 359, 180].map(compass)).toEqual(['N', 'N', 'NE', 'N', 'S']);
  });
});
