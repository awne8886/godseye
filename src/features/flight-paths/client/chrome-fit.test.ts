// @vitest-environment node
/**
 * Round 3b: compact live chip (R3-m3), endpoint label offsets (R3-m4) and the framing area around
 * the edge chrome — phone sheet (R3-m5) and the left rail / docked panel (R3-m9). Pure functions,
 * no DOM. The overlay-aware placement (chips, attribution, view controls) is in framing.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { liveChip, liveCounts } from './PathsPanel';
import { frameArea, hudChrome, PHONE_FRAME_MARGIN_PX } from './framing';
import { sheetOccupiedPx, sheetRect } from './insets';
import { endpointLabelOffset, LABEL_GAP_X_PX, LABEL_GAP_Y_PX } from './layers';

const M = { basis: 'matched' as const };
const I = { basis: 'inferred' as const };

describe('live header chip (R3-m3)', () => {
  it('drops a zero count and abbreviates only when both are present, never summing', () => {
    expect(liveChip([])).toBe('0 AIRCRAFT');
    expect(liveChip([M])).toBe('1 MATCHED');
    expect(liveChip([I, I])).toBe('2 INFERRED');
    expect(liveChip([I, M, I])).toBe('1 M · 2 I');
    expect(liveChip([M, M, M, M, M, M, M, M, M, M, M, M, I, I, I])).toBe('12 M · 3 I');
    // Every form fits the ~14-character header slot.
    for (const a of [[], [M], [I, I], [I, M, I]]) expect(liveChip(a).length).toBeLessThanOrEqual(14);
    // The tab body keeps the full wording.
    expect(liveCounts([M])).toBe('1 MATCHED · 0 INFERRED');
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
