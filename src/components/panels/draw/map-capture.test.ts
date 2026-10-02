// @vitest-environment jsdom
// r5 R4-M2: while a DRAW tool is armed, a tap/click on the canvas adds a vertex and never reaches
// MapLibre's click event (the map host's click-to-select router), so no entity card opens over the
// phone sheet. Modelled on MapLibre's DOM wiring: its HandlerManager listens for `click`/`dblclick`
// on the canvas container in the bubble phase and turns them into map events.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLICK_TOLERANCE_PX, DOUBLE_CLICK_MS, canvasPoint, captureMapClicks, isRepeatClick, keyForSketch, type CaptureMap } from './map-capture';

function fakeMap() {
  const host = document.createElement('div');
  const container = document.createElement('div');
  const canvas = document.createElement('canvas');
  const control = document.createElement('button');
  container.appendChild(canvas);
  host.append(container, control);
  document.body.appendChild(host);
  // What MapLibre's HandlerManager does: bubble listeners on the canvas container → map events.
  const mapClick = vi.fn();
  const mapDbl = vi.fn();
  container.addEventListener('click', mapClick);
  container.addEventListener('dblclick', mapDbl);
  const map: CaptureMap = {
    getContainer: () => host,
    getCanvasContainer: () => container,
    getCanvas: () => canvas,
    unproject: ([x, y]) => ({ lng: x / 10, lat: -y / 10 }),
  };
  return { map, host, container, canvas, control, mapClick, mapDbl };
}

const click = (el: Element, x: number, y: number, init: MouseEventInit = {}) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...init }));
const down = (el: Element, x: number, y: number) => el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));

describe('captureMapClicks (DRAW owns the canvas while armed)', () => {
  let m: ReturnType<typeof fakeMap>;
  beforeEach(() => {
    m = fakeMap();
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('turns a canvas click into a vertex and keeps it from MapLibre (no selection pick)', () => {
    const onPoint = vi.fn();
    const release = captureMapClicks(m.map, { onPoint, onDouble: vi.fn() });
    down(m.canvas, 120, 40);
    click(m.canvas, 120, 40);
    expect(onPoint).toHaveBeenCalledWith([12, -4], [120, 40]);
    expect(m.mapClick).not.toHaveBeenCalled();
    // A tap: the browser's compatibility mousedown/click pair, after a touchstart.
    m.canvas.dispatchEvent(new Event('touchstart', { bubbles: true }));
    down(m.canvas, 50, 60);
    click(m.canvas, 50, 60);
    expect(onPoint).toHaveBeenLastCalledWith([5, -6], [50, 60]);
    expect(m.mapClick).not.toHaveBeenCalled();
    release();
    // Released: clicks select entities again.
    click(m.canvas, 10, 10);
    expect(m.mapClick).toHaveBeenCalledTimes(1);
    expect(onPoint).toHaveBeenCalledTimes(2);
  });

  it('a drag (press moved ≥ the click tolerance) adds nothing; a touch never inherits a stale mouse press', () => {
    const onPoint = vi.fn();
    captureMapClicks(m.map, { onPoint, onDouble: vi.fn() });
    down(m.canvas, 10, 10);
    click(m.canvas, 10 + CLICK_TOLERANCE_PX, 10);
    expect(onPoint).not.toHaveBeenCalled();
    down(m.canvas, 10, 10);
    m.canvas.dispatchEvent(new Event('touchstart', { bubbles: true }));
    click(m.canvas, 200, 200);
    expect(onPoint).toHaveBeenCalledTimes(1);
    expect(m.mapClick).not.toHaveBeenCalled();
  });

  it('double-click finishes and never reaches MapLibre (no double-click zoom, no map dblclick)', () => {
    const onDouble = vi.fn();
    captureMapClicks(m.map, { onPoint: vi.fn(), onDouble });
    const ev = new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 });
    m.canvas.dispatchEvent(ev);
    expect(onDouble).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
    expect(m.mapDbl).not.toHaveBeenCalled();
  });

  it('leaves controls, right clicks and non-canvas targets alone', () => {
    const onPoint = vi.fn();
    captureMapClicks(m.map, { onPoint, onDouble: vi.fn() });
    const ctl = vi.fn();
    m.control.addEventListener('click', ctl);
    click(m.control, 1, 1);
    expect(ctl).toHaveBeenCalledTimes(1);
    const marker = document.createElement('div');
    m.container.appendChild(marker);
    click(marker, 1, 1);
    expect(m.mapClick).toHaveBeenCalledTimes(1); // a marker inside the canvas container still behaves normally
    click(m.canvas, 1, 1, { button: 2 });
    expect(onPoint).not.toHaveBeenCalled();
  });

  it('marks the map container and pins the crosshair against the hover pointer, then restores both', async () => {
    const release = captureMapClicks(m.map, { onPoint: vi.fn(), onDouble: vi.fn() });
    expect(m.host.dataset.mapTool).toBe('draw');
    expect(m.canvas.style.cursor).toBe('crosshair');
    // The map host's hover feedback: pointer over an entity, then '' when it leaves.
    m.canvas.style.cursor = 'pointer';
    await Promise.resolve();
    expect(m.canvas.style.cursor).toBe('crosshair');
    release();
    expect(m.host.dataset.mapTool).toBeUndefined();
    expect(m.canvas.style.cursor).toBe('');
  });

  it('computes canvas pixels like MapLibre (CSS scale, borders)', () => {
    const el = { getBoundingClientRect: () => ({ left: 100, top: 50, width: 400, height: 200 }), offsetWidth: 800, offsetHeight: 400, clientLeft: 1, clientTop: 2 } as unknown as HTMLElement;
    expect(canvasPoint(el, { clientX: 300, clientY: 150 })).toEqual([399, 198]);
  });
});

describe('keyForSketch', () => {
  const t = (tag: string, extra: Partial<HTMLElement> = {}) => Object.assign(document.createElement(tag), extra);
  it('Enter finishes and Esc cancels from the map or page', () => {
    expect(keyForSketch({ key: 'Enter', target: document.body })).toBe('finish');
    expect(keyForSketch({ key: 'Enter', target: t('canvas') })).toBe('finish');
    expect(keyForSketch({ key: 'Escape', target: document.body })).toBe('cancel');
    expect(keyForSketch({ key: 'Escape', target: t('button') })).toBe('cancel');
  });
  it('text fields and focused buttons keep Enter; IME and auto-repeat are ignored', () => {
    expect(keyForSketch({ key: 'Enter', target: t('input') })).toBeNull();
    expect(keyForSketch({ key: 'Enter', target: t('button') })).toBeNull();
    expect(keyForSketch({ key: 'Escape', target: t('textarea') })).toBeNull();
    expect(keyForSketch({ key: 'Enter', target: document.body, isComposing: true })).toBeNull();
    expect(keyForSketch({ key: 'Enter', target: document.body, repeat: true })).toBeNull();
    expect(keyForSketch({ key: 'a', target: document.body })).toBeNull();
  });
});

describe('isRepeatClick (r5: a double-click must not drop two identical points)', () => {
  const last = { px: [100, 100] as [number, number], at: 1000 };
  it('the second click of a dblclick with the Point tool is not a second point', () => {
    expect(isRepeatClick(last, [101, 100], 1000 + 120, 0, true)).toBe(true);
  });
  it('a later click on the same spot with the Point tool is a deliberate second point', () => {
    expect(isRepeatClick(last, [100, 100], 1000 + DOUBLE_CLICK_MS + 1, 0, true)).toBe(false);
  });
  it('a quick click elsewhere is a new point', () => {
    expect(isRepeatClick(last, [100 + CLICK_TOLERANCE_PX, 100], 1010, 0, true)).toBe(false);
  });
  it('with a sketch in progress, a click on the vertex just added is a repeat whatever the delay', () => {
    expect(isRepeatClick(last, [100, 101], 9000, 2, false)).toBe(true);
  });
  it('without a sketch or Point tool (first vertex of a line), nothing is a repeat', () => {
    expect(isRepeatClick(last, [100, 100], 1050, 0, false)).toBe(false);
    expect(isRepeatClick(null, [100, 100], 1050, 3, true)).toBe(false);
  });
});
