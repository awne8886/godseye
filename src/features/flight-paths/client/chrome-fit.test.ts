// @vitest-environment node
/**
 * Round 3b: compact live chip (R3-m3), endpoint label offsets (R3-m4) and fit padding around the
 * measured chrome — phone sheet (R3-m5) and the view-controls bar (R3-m9). Pure functions, no DOM.
 */
import { describe, expect, it } from 'vitest';
import { liveChip, liveCounts } from './PathsPanel';
import { sheetOccupiedPx, sheetRect } from './insets';
import { endpointLabelOffset, framePadding, LABEL_GAP_X_PX, LABEL_GAP_Y_PX, OBSTACLE_CLEAR_PX, padForObstacles } from './layers';

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

describe('fit padding around measured chrome (R3-m5, R3-m9)', () => {
  it('raises the bottom padding over the desktop bottom-left view-controls bar', () => {
    const vp = { width: 1600, height: 1000 };
    const base = framePadding(vp, { side: 'right', size: 424 });
    // ViewControls: md:bottom-[100px] md:left-[120px], ~375 × 42 px.
    const controls = { left: 120, top: 858, right: 495, bottom: 900 };
    const p = framePadding(vp, { side: 'right', size: 424 }, [controls]);
    expect(p.bottom).toBe(1000 - 858 + OBSTACLE_CLEAR_PX);
    expect({ ...p, bottom: base.bottom }).toEqual(base); // other edges untouched
  });

  it('raises the top padding over the phone top-left controls and the bottom over the sheet + lifted attribution', () => {
    const vp = { width: 390, height: 844 };
    const occupied = sheetOccupiedPx('', vp.height); // not yet published → CSS bound 56 + 55vh
    expect(occupied).toBe(Math.round(56 + 844 * 0.55));
    const sheet = sheetRect(vp, occupied);
    const controls = { left: 12, top: 64, right: 320, bottom: 116 };
    const attribution = { left: 40, top: sheet.top - 50, right: 390, bottom: sheet.top - 4 };
    const p = framePadding(vp, null, [attribution, controls, sheet]);
    expect(p.top).toBe(116 + OBSTACLE_CLEAR_PX);
    // Sheet first (largest), then the attribution adds only its own height on the same edge.
    const free = vp.height - p.top - p.bottom;
    expect(free).toBeGreaterThanOrEqual(Math.floor(vp.height * 0.2));
    expect(p.bottom).toBeGreaterThan(occupied);
  });

  it('uses the published sheet height when PanelHost has written it', () => {
    expect(sheetOccupiedPx('410px', 844)).toBe(410);
    const vp = { width: 390, height: 844 };
    const p = framePadding(vp, null, [sheetRect(vp, 410)]);
    expect(p.bottom).toBe(410 + OBSTACLE_CLEAR_PX);
  });

  it('ignores chrome outside the free area and never over-pads an axis', () => {
    const vp = { width: 1440, height: 900 };
    const base = framePadding(vp, null);
    // A box inside the status-bar strip is already clear.
    expect(padForObstacles(vp, base, [{ left: 400, top: 880, right: 900, bottom: 900 }])).toEqual(base);
    // A huge box cannot squeeze the free area below 20 %.
    const p = padForObstacles(vp, base, [{ left: 0, top: 100, right: 1440, bottom: 900 }]);
    expect(vp.height - p.top - p.bottom).toBeGreaterThanOrEqual(Math.floor(vp.height * 0.2) - 1);
  });
});
