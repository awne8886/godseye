// @vitest-environment node
/**
 * Round 3b: compact live chip (R3-m3), endpoint label offsets (R3-m4) and the framing area around
 * the edge chrome — phone sheet (R3-m5) and the left rail / docked panel (R3-m9). Pure functions,
 * no DOM. The overlay-aware placement (chips, attribution, view controls) is in framing.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { liveChip, liveCounts } from './PathsPanel';
import { frameArea, hudChrome, labelBox, labelOffsetCandidates, PHONE_FRAME_MARGIN_PX, pickLabelOffset } from './framing';
import { sheetOccupiedPx, sheetRect } from './insets';
import { endpointLabelOffset, LABEL_GAP_X_PX, LABEL_GAP_Y_PX } from './layers';

const M = { basis: 'matched' as const };
const I = { basis: 'inferred' as const };

describe('live header chip (R3-m3, round 5 visual-qa: "6 M · 1 I" was cryptic)', () => {
  it('says MATCHED or INFERRED in words, never abbreviated, never summed', () => {
    expect(liveChip([])).toBe('0 AIRCRAFT');
    expect(liveChip([M])).toBe('1 MATCHED');
    expect(liveChip([I, I])).toBe('2 INFERRED');
    // Both present: the matched count in words; the inferred count is in the tooltip and the tab.
    expect(liveChip([I, M, I])).toBe('1 MATCHED');
    expect(liveChip([M, M, M, M, M, M, M, M, M, M, M, M, I, I, I])).toBe('12 MATCHED');
    for (const a of [[I, M, I], [M, M, M, M, M, M, I]]) expect(liveChip(a)).not.toMatch(/\b[MI]\b/);
    // Every form fits the ~14-character header slot (no ellipsis).
    for (const a of [[], [M], [I, I], [I, M, I], Array.from({ length: 150 }, () => I)]) expect(liveChip(a).length).toBeLessThanOrEqual(14);
    // The tooltip and the tab body keep the full wording.
    expect(liveCounts([M])).toBe('1 MATCHED · 0 INFERRED');
    expect(liveCounts([M, M, M, M, M, M, I])).toBe('6 MATCHED · 1 INFERRED');
  });
});

describe('endpoint label offset (R3-m4)', () => {
  it('puts the label on the side away from the arc', () => {
    const LHR: [number, number] = [-0.4614, 51.4775];
    // LHR→JFK leaves to the west-north-west: the label goes east.
    const [x, y] = endpointLabelOffset(LHR, [-10, 54]);
    expect(x).toBeGreaterThan(0);
    expect(y).toBeGreaterThan(0); // arc rises to the north → label below
    // SCL with the arc arriving from the west (Pacific): label to the east.
    const SCL: [number, number] = [-70.7858, -33.393];
    expect(endpointLabelOffset(SCL, [-90, -40])[0]).toBeGreaterThan(LABEL_GAP_X_PX / 2);
    // Due north arc → label straight below.
    expect(endpointLabelOffset([0, 0], [0, 10])).toEqual([0, LABEL_GAP_Y_PX]);
    expect(endpointLabelOffset([0, 0], null)).toEqual([0, -LABEL_GAP_Y_PX]);
    expect(endpointLabelOffset([0, 0], [0, 0])).toEqual([0, -LABEL_GAP_Y_PX]);
  });
});

describe('endpoint label side off the basemap labels (round 5 visual-qa: the SCL pill over "CHILE")', () => {
  // SCL with the arc arriving from the west: the default side is east of the dot.
  const def = endpointLabelOffset([-70.7858, -33.393], [-90, -40]);
  const xy: [number, number] = [600, 400];

  it('candidates: the default side first, then turned ±50° and ±100° on the label ellipse — never back onto the arc', () => {
    const c = labelOffsetCandidates(def);
    expect(c[0]).toEqual(def);
    expect(c.length).toBe(5);
    // Every candidate keeps the label's distance from the dot (on the 28 × 17 px ellipse).
    for (const [x, y] of c) expect((x / LABEL_GAP_X_PX) ** 2 + (y / LABEL_GAP_Y_PX) ** 2).toBeCloseTo(1, 0);
    // None turns more than ~100° from the default side, i.e. none points back along the arc.
    const dir = ([x, y]: readonly [number, number]) => Math.atan2(y / LABEL_GAP_Y_PX, x / LABEL_GAP_X_PX);
    for (const k of c) expect(Math.abs(((dir(k) - dir(def) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI)).toBeLessThanOrEqual((102 * Math.PI) / 180);
  });

  it('pickLabelOffset: the first side whose pill is free; the default when none is', () => {
    const c = labelOffsetCandidates(def);
    // A basemap label ("CHILE") over the default pill only: the next side is taken.
    const chile = { left: xy[0] + def[0] - 30, top: xy[1] + def[1] - 9, right: xy[0] + def[0] + 30, bottom: xy[1] + def[1] + 9 };
    const free = (b: { left: number; top: number; right: number; bottom: number }) => !(b.left < chile.right && b.right > chile.left && b.top < chile.bottom && b.bottom > chile.top);
    const picked = pickLabelOffset('SCL', xy, c, free);
    expect(picked).not.toEqual(def);
    expect(c).toContainEqual(picked);
    const box = labelBox('SCL', picked);
    expect(free({ left: xy[0] + box.left, right: xy[0] + box.right, top: xy[1] + box.top, bottom: xy[1] + box.bottom })).toBe(true);
    // Nothing free: the default side (the framing's own choice) stays.
    expect(pickLabelOffset('SCL', xy, c, () => false)).toEqual(def);
    expect(pickLabelOffset('SCL', xy, c, () => true)).toEqual(def);
  });
});

describe('framing area around the edge chrome (R3-m5, R3-m9)', () => {
  it('desktop: header band, status bar and the 48 px left rail plus 40 px, the docked panel on the right', () => {
    expect(frameArea({ width: 1600, height: 1000 }, { side: 'right', size: 424 })).toEqual({ left: 88, top: 104, right: 1600 - 464, bottom: 1000 - 68 });
  });

  it('phone: a 16 px margin and the sheet at its published height, else its 55vh CSS bound', () => {
    const vp = { width: 390, height: 844 };
    const occupied = sheetOccupiedPx('', vp.height); // not yet published → CSS bound 56 + 55vh
    expect(occupied).toBe(Math.round(56 + 844 * 0.55));
    const area = frameArea(vp, { side: 'bottom', size: occupied });
    expect(area.top).toBe(64 + PHONE_FRAME_MARGIN_PX);
    expect(area.left).toBe(PHONE_FRAME_MARGIN_PX);
    expect(area.bottom).toBeLessThanOrEqual(sheetRect(vp, occupied).top - PHONE_FRAME_MARGIN_PX);
    // The published value wins once PanelHost has written it.
    expect(sheetOccupiedPx('410px', 844)).toBe(410);
    expect(frameArea(vp, { side: 'bottom', size: 410 }).bottom).toBe(844 - 410 - PHONE_FRAME_MARGIN_PX);
  });

  it('landscape phone (844×390, the HUD phone layout by media query): no rail, the phone margin, the sheet below (round 4 fix pass)', () => {
    const vp = { width: 844, height: 390 };
    // By width alone 844 px would be desktop (48 px rail, 40 px margin): RouteLayer passes isPhoneLayout().
    expect(hudChrome(vp).left).toBe(48);
    expect(hudChrome(vp, true).left).toBe(0);
    const area = frameArea(vp, { side: 'bottom', size: 270 }, true);
    expect(area.left).toBe(PHONE_FRAME_MARGIN_PX);
    expect(area.right).toBe(844 - PHONE_FRAME_MARGIN_PX);
    expect(area.top).toBe(64 + PHONE_FRAME_MARGIN_PX);
    // The sheet share is capped so a quarter of the height stays for the route (the marks then
    // avoid the sheet as an obstacle).
    expect(area.bottom).toBe(390 - (390 * 0.75 - area.top)); // 177.5
    expect(frameArea(vp, { side: 'bottom', size: 270 }).left).toBe(88);
  });
});
