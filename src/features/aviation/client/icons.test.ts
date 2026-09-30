import { describe, expect, it } from 'vitest';
import { sdf } from './icons';

const SPREAD = 8;

/** The former brute-force window scan: the reference the fast transform must match exactly. */
function bruteSdf(inside: Uint8Array, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const me = inside[y * w + x]!;
      let best = SPREAD * SPREAD;
      for (let dy = -SPREAD; dy <= SPREAD; dy++) {
        for (let dx = -SPREAD; dx <= SPREAD; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          const other = yy < 0 || yy >= h || xx < 0 || xx >= w ? 0 : inside[yy * w + xx]!;
          if (other !== me) best = Math.min(best, dx * dx + dy * dy);
        }
      }
      const dist = Math.sqrt(best) - 0.5;
      out[y * w + x] = Math.round(Math.max(0, Math.min(1, 0.5 + (me ? dist : -dist) / (2 * SPREAD))) * 255);
    }
  }
  return out;
}

describe('SDF atlas distance field (perf M3)', () => {
  it('matches the brute-force reference exactly on a plane-like mask touching the box edge', () => {
    const w = 64;
    const h = 64;
    const inside = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const fuselage = Math.abs(x - 32) <= 3 && y >= 2 && y <= 62;
        const wing = y >= 26 && y <= 36 && Math.abs(x - 32) <= 30 - (y - 26);
        const ring = Math.abs(Math.hypot(x - 20, y - 50) - 9) <= 1.2;
        inside[y * w + x] = fuselage || wing || ring || x === 63 ? 1 : 0;
      }
    }
    expect([...sdf(inside, w, h)]).toEqual([...bruteSdf(inside, w, h)]);
  });

  it('handles an empty and a full box', () => {
    const empty = new Uint8Array(16 * 16);
    expect([...sdf(empty, 16, 16)]).toEqual([...bruteSdf(empty, 16, 16)]);
    const full = new Uint8Array(16 * 16).fill(1);
    expect([...sdf(full, 16, 16)]).toEqual([...bruteSdf(full, 16, 16)]);
    expect(sdf(full, 16, 16)[8 * 16 + 8]).toBeGreaterThan(sdf(full, 16, 16)[0]!); // deeper inside = higher
  });
});
