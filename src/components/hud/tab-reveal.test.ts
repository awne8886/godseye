import { describe, expect, it } from 'vitest';
import { tabRevealScroll } from './tab-reveal';

describe('r7 m: the phone sheet scrolls the selected tab into view', () => {
  it('leaves a fully readable tab alone', () => {
    expect(tabRevealScroll({ scrollLeft: 0, viewWidth: 300, tabLeft: 12, tabWidth: 80 })).toBe(0);
  });
  it('brings a tab past the right edge (STYLE STUDIO, third tab at 390 px) out of the fade', () => {
    // 300 px strip, 24 px fade → 276 px clear; the tab spans 230–340.
    const next = tabRevealScroll({ scrollLeft: 0, viewWidth: 300, tabLeft: 230, tabWidth: 110 });
    expect(next).toBe(64);
    expect(230 + 110 - next).toBeLessThanOrEqual(276);
  });
  it('treats a tab under the fade as hidden', () => {
    expect(tabRevealScroll({ scrollLeft: 0, viewWidth: 300, tabLeft: 200, tabWidth: 90 })).toBe(14);
  });
  it('scrolls back for a tab off the left edge, keeping the leading padding', () => {
    expect(tabRevealScroll({ scrollLeft: 200, viewWidth: 300, tabLeft: 40, tabWidth: 80 })).toBe(28);
  });
  it('aligns the start of a tab wider than the clear area', () => {
    expect(tabRevealScroll({ scrollLeft: 0, viewWidth: 120, tabLeft: 150, tabWidth: 130 })).toBe(138);
  });
  it('the end padding equals the fade, so the last tab can always leave it', () => {
    // Strip content 600 px incl. 24 px end padding; last tab 480–576; max scroll 300.
    const next = tabRevealScroll({ scrollLeft: 0, viewWidth: 300, tabLeft: 480, tabWidth: 96 });
    expect(next).toBe(300);
  });
  it('does nothing before layout (zero width)', () => {
    expect(tabRevealScroll({ scrollLeft: 5, viewWidth: 0, tabLeft: 400, tabWidth: 80 })).toBe(5);
  });
});
