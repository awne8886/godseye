// @vitest-environment jsdom
// r5 R4-M2: on a phone a line/polygon could not be finished — "Done" threw the sketch away and only
// dblclick/Enter (neither exists on touch) finished it. These pin the fix: an explicit FINISH that
// commits, a separate CANCEL that discards, DONE that keeps a finishable sketch, touch wording on
// coarse pointers, and 44 px targets on both phone layouts (portrait < 768 px, landscape < 500 px tall).
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import DrawPanel, { sketchStatus } from './DrawPanel';
import { addDrawPoint, useOverlayStore } from '../recon/overlay-store';
import { sketchFeature, verticesToFinish } from './geometry';

const panel = () => render(<DrawPanel {...({} as Parameters<typeof DrawPanel>[0])} />);
const reset = () => useOverlayStore.setState({ drawMode: null, sketch: [], features: [] });
// Madrid, Barcelona, Valencia (Madrid–Barcelona is 280.88 NM great-circle).
const A: [number, number] = [-3.7, 40.4];
const B: [number, number] = [2.35, 41.39];
const C: [number, number] = [-0.38, 39.47];

function setCoarse(coarse: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (q: string) => ({ matches: coarse && q === '(pointer: coarse)', media: q, addEventListener: () => undefined, removeEventListener: () => undefined }),
  });
}

beforeEach(reset);
afterEach(() => {
  cleanup();
  reset();
  Reflect.deleteProperty(window, 'matchMedia');
});

describe('DRAW store: finish, cancel, done', () => {
  it('FINISH commits a 2-vertex line and keeps the tool armed', () => {
    useOverlayStore.getState().setDrawMode('line');
    addDrawPoint(A);
    addDrawPoint(B);
    const f = useOverlayStore.getState().finishSketch();
    expect(f?.geometry).toEqual({ type: 'LineString', coordinates: [A, B] });
    const s = useOverlayStore.getState();
    expect(s.features).toHaveLength(1);
    expect(s.sketch).toEqual([]);
    expect(s.drawMode).toBe('line');
  });

  it('a premature FINISH loses nothing (polygon needs 3 corners)', () => {
    useOverlayStore.getState().setDrawMode('polygon');
    addDrawPoint(A);
    addDrawPoint(B);
    expect(useOverlayStore.getState().finishSketch()).toBeNull();
    expect(useOverlayStore.getState().sketch).toEqual([A, B]);
    addDrawPoint(C);
    expect(useOverlayStore.getState().finishSketch()?.geometry).toEqual({ type: 'Polygon', coordinates: [[A, B, C, A]] });
  });

  it('DONE (stopDrawing) keeps the line instead of clearing it — the round-5 phone bug', () => {
    useOverlayStore.getState().setDrawMode('line');
    addDrawPoint(A);
    addDrawPoint(B);
    useOverlayStore.getState().stopDrawing();
    const s = useOverlayStore.getState();
    expect(s.drawMode).toBeNull();
    expect(s.features.map((f) => f.geometry.type)).toEqual(['LineString']);
  });

  it('CANCEL discards the sketch only; switching tools keeps a finishable sketch', () => {
    const st = useOverlayStore.getState;
    st().setDrawMode('line');
    addDrawPoint(A);
    addDrawPoint(B);
    st().cancelSketch();
    expect(st().sketch).toEqual([]);
    expect(st().features).toEqual([]);
    expect(st().drawMode).toBe('line');
    addDrawPoint(A);
    addDrawPoint(B);
    st().setDrawMode('polygon');
    expect(st().features).toHaveLength(1);
    expect(st().drawMode).toBe('polygon');
    // One stray vertex cannot be a shape: dropped on stop.
    addDrawPoint(C);
    st().stopDrawing();
    expect(st().features).toHaveLength(1);
  });

  it('counts what FINISH still needs', () => {
    expect(verticesToFinish('line', [A])).toBe(1);
    expect(verticesToFinish('polygon', [A])).toBe(2);
    expect(verticesToFinish('polygon', [A, B, C])).toBe(0);
    expect(verticesToFinish('point', [])).toBeNull();
    expect(verticesToFinish('circle', [A])).toBeNull();
    expect(verticesToFinish(null, [])).toBeNull();
    expect(sketchFeature('line', [A], () => 'x', 1)).toBeNull();
    expect(sketchStatus('line', [A], 'aviation')).toBe('1 vertex · 1 more to finish');
    expect(sketchStatus('line', [A, B], 'aviation')).toMatch(/^2 vertices · \d{3}\.\d{2} NM$/);
    expect(sketchStatus('polygon', [A, B, C], 'metric')).toMatch(/^3 vertices · [\d.]+ km²$/);
  });
});

describe('DrawPanel FINISH / CANCEL / DONE', () => {
  it('shows FINISH for lines, disabled until the second vertex, and FINISH adds the measured line', () => {
    panel();
    fireEvent.click(screen.getByRole('button', { name: 'Line' }));
    const finish = screen.getByRole('button', { name: 'Finish' });
    expect(finish).toHaveProperty('disabled', true);
    act(() => addDrawPoint(A));
    expect(screen.getByTestId('draw-sketch').textContent).toBe('1 vertex · 1 more to finish');
    expect(finish.getAttribute('title')).toBe('Add 1 more vertex first');
    act(() => addDrawPoint(B));
    expect(screen.getByTestId('draw-sketch').textContent).toBe('2 vertices · 280.88 NM');
    expect(finish).toHaveProperty('disabled', false);
    fireEvent.click(finish);
    expect(screen.getAllByTestId('draw-measure').map((e) => e.textContent)).toEqual(['280.88 NM']);
    expect(screen.queryByTestId('draw-sketch')).toBeNull();
    // Still armed for the next line.
    expect(screen.getByRole('button', { name: 'Line' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('DONE keeps the line and disarms; CANCEL discards', () => {
    panel();
    fireEvent.click(screen.getByRole('button', { name: 'Line' }));
    act(() => addDrawPoint(A));
    act(() => addDrawPoint(B));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel the shape in progress' }));
    expect(screen.queryAllByTestId('draw-measure')).toHaveLength(0);
    act(() => addDrawPoint(A));
    act(() => addDrawPoint(B));
    fireEvent.click(screen.getByRole('button', { name: 'Stop drawing' }));
    expect(screen.getAllByTestId('draw-measure')).toHaveLength(1);
    expect(useOverlayStore.getState().drawMode).toBeNull();
    expect(screen.queryByRole('button', { name: 'Finish' })).toBeNull();
  });

  it('no FINISH for points and circles (they commit on the tap)', () => {
    panel();
    fireEvent.click(screen.getByRole('button', { name: 'Circle' }));
    expect(screen.queryByRole('button', { name: 'Finish' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Stop drawing' })).toBeTruthy();
  });

  it('touch wording on coarse pointers, mouse wording otherwise', () => {
    setCoarse(true);
    panel();
    expect(screen.getByText(/then tap the map/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Polygon' }));
    expect(screen.getByText('Tap to add 3 or more corners, then tap FINISH to close the shape. CANCEL discards it.')).toBeTruthy();
    expect(screen.queryByText(/double-click/)).toBeNull();
    cleanup();
    setCoarse(false);
    panel();
    expect(screen.getByText(/then click the map/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Polygon' }));
    expect(screen.getByText(/FINISH, double-click or Enter closes the shape/)).toBeTruthy();
  });

  it('sketch actions are 44 px on phones (portrait and landscape phone layouts)', () => {
    panel();
    fireEvent.click(screen.getByRole('button', { name: 'Line' }));
    for (const b of screen.getByRole('group', { name: 'Sketch actions' }).querySelectorAll('button')) {
      // `phone:` is exactly PHONE_LAYOUT_QUERY: portrait (< 768 px) and landscape (≤ 499 px tall) phones.
      expect(b.className).toContain('phone:min-h-11');
      expect(b.className).not.toMatch(/(?:^|\s)(?:max-)?md:/);
    }
  });

  it('armed: the sketch actions come before the tool grid (landscape phones see FINISH unscrolled); the pressed tool keeps focus', () => {
    panel();
    const before = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const lineBtn = screen.getByRole('button', { name: 'Line' });
    lineBtn.focus();
    fireEvent.click(lineBtn);
    expect(before(screen.getByRole('group', { name: 'Sketch actions' }), screen.getByRole('group', { name: 'Drawing tools' }))).toBe(true);
    // Not remounted: the same node, still focused.
    expect(screen.getByRole('button', { name: 'Line' })).toBe(lineBtn);
    expect(document.activeElement).toBe(lineBtn);
    fireEvent.click(lineBtn);
    expect(screen.queryByRole('group', { name: 'Sketch actions' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Line' })).toBe(lineBtn);
  });

  it('closing the panel keeps a finishable sketch and disarms the tool', () => {
    const { unmount } = panel();
    fireEvent.click(screen.getByRole('button', { name: 'Line' }));
    act(() => addDrawPoint(A));
    act(() => addDrawPoint(B));
    unmount();
    expect(useOverlayStore.getState().drawMode).toBeNull();
    expect(useOverlayStore.getState().features).toHaveLength(1);
  });
});
