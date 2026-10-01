/**
 * While a DRAW tool is armed the map canvas belongs to the tool: a click or tap adds a vertex and
 * never reaches the map's click-to-select router, so no entity is picked (no GPU pick, no card
 * opening over the phone sheet). MapLibre turns DOM `click`/`dblclick` on its canvas container into
 * map events; listening on that container in the CAPTURE phase and stopping propagation keeps those
 * map events (and with them every `map.on('click')` selection handler) from firing at all, for
 * clicks on the canvas only — controls, markers and popups are untouched. Presses, drags, pinches
 * and hover are not intercepted, so panning, zooming and the cursor readout keep working.
 * The map container carries `data-map-tool="draw"` meanwhile (for the map host and e2e).
 * Owner: panels-recon. DOM-only (no MapLibre import), unit-tested in jsdom.
 */

/** The parts of a MapLibre map this module touches. */
export interface CaptureMap {
  getContainer(): HTMLElement;
  getCanvasContainer(): HTMLElement;
  getCanvas(): HTMLElement;
  unproject(point: [number, number]): { lng: number; lat: number };
}

export interface CaptureHandlers {
  /** A click/tap on the canvas (not a drag), as [lng, lat] and canvas pixels. */
  onPoint: (lngLat: [number, number], px: [number, number]) => void;
  /** A double-click on the canvas (desktop FINISH gesture). */
  onDouble: () => void;
}

/** MapLibre's default `clickTolerance`: a press that moved this far is a drag, not a click. */
export const CLICK_TOLERANCE_PX = 3;

/** Canvas-pixel position of a mouse event, as MapLibre computes it (CSS-scale aware, borders excluded). */
/** Two clicks on the same spot closer than this are one double-click (browser default is ~500 ms). */
export const DOUBLE_CLICK_MS = 500;

/** The previous canvas click, for {@link isRepeatClick}. */
export interface LastClick {
  px: [number, number];
  at: number;
}

/**
 * True when a click is the second half of a double-click on the spot the first click already used:
 * with a sketch in progress any click on that spot (it would duplicate the vertex just added); with
 * the Point tool, which commits on every click and leaves the sketch empty, only within
 * DOUBLE_CLICK_MS (a later click on the same spot is a deliberate second point).
 */
export function isRepeatClick(last: LastClick | null, px: [number, number], at: number, sketchLength: number, pointTool: boolean): boolean {
  if (!last || Math.hypot(px[0] - last.px[0], px[1] - last.px[1]) >= CLICK_TOLERANCE_PX) return false;
  return sketchLength > 0 || (pointTool && at - last.at < DOUBLE_CLICK_MS);
}

export function canvasPoint(el: HTMLElement, e: { clientX: number; clientY: number }): [number, number] {
  const rect = el.getBoundingClientRect();
  const sx = el.offsetWidth ? rect.width / el.offsetWidth : 1;
  const sy = el.offsetHeight ? rect.height / el.offsetHeight : 1;
  return [(e.clientX - rect.left) / (sx || 1) - el.clientLeft, (e.clientY - rect.top) / (sy || 1) - el.clientTop];
}

/**
 * Route canvas clicks to the DRAW tool until the returned function is called. Also pins the
 * crosshair: the map host's hover feedback sets `cursor: pointer` over entities and clears it
 * afterwards, which would otherwise drop the tool's cursor.
 */
export function captureMapClicks(map: CaptureMap, handlers: CaptureHandlers, cursor = 'crosshair'): () => void {
  const container = map.getCanvasContainer();
  const canvas = map.getCanvas();
  const host = map.getContainer();
  let pressAt: [number, number] | null = null;
  const onCanvas = (e: Event) => e.target === canvas;

  // Drag detection mirrors MapLibre's own: the press position is the `mousedown` (for a tap, the
  // browser's compatibility mousedown lands where the click does), and a touch never inherits a
  // stale mouse press.
  const press = (e: MouseEvent) => {
    pressAt = onCanvas(e) ? canvasPoint(canvas, e) : null;
  };
  const touch = () => {
    pressAt = null;
  };
  const click = (e: MouseEvent) => {
    if (!onCanvas(e)) return;
    // Stop here so MapLibre never fires its `click` (the selection router listens to that).
    e.stopPropagation();
    if ((e.button ?? 0) !== 0) return;
    const px = canvasPoint(canvas, e);
    const from = pressAt;
    pressAt = null;
    if (from && Math.hypot(px[0] - from[0], px[1] - from[1]) >= CLICK_TOLERANCE_PX) return; // a drag
    const ll = map.unproject(px);
    if (!Number.isFinite(ll.lng) || !Number.isFinite(ll.lat)) return;
    handlers.onPoint([ll.lng, ll.lat], px);
  };
  const dbl = (e: MouseEvent) => {
    if (!onCanvas(e)) return;
    e.stopPropagation();
    e.preventDefault();
    handlers.onDouble();
  };

  const prevCursor = canvas.style.cursor;
  canvas.style.cursor = cursor;
  const pin =
    typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver(() => {
          if (canvas.style.cursor !== cursor) canvas.style.cursor = cursor;
        });
  pin?.observe(canvas, { attributes: true, attributeFilter: ['style'] });

  host.dataset.mapTool = 'draw';
  container.addEventListener('mousedown', press, true);
  container.addEventListener('touchstart', touch, { capture: true, passive: true });
  container.addEventListener('click', click, true);
  container.addEventListener('dblclick', dbl, true);
  return () => {
    container.removeEventListener('mousedown', press, true);
    container.removeEventListener('touchstart', touch, true);
    container.removeEventListener('click', click, true);
    container.removeEventListener('dblclick', dbl, true);
    pin?.disconnect();
    canvas.style.cursor = prevCursor === cursor ? '' : prevCursor;
    delete host.dataset.mapTool;
  };
}

/** Enter/Escape belong to text fields and buttons when one has focus (Enter on FINISH must not finish twice). */
export function keyForSketch(e: { key: string; target: EventTarget | null; isComposing?: boolean; repeat?: boolean }): 'finish' | 'cancel' | null {
  if (e.isComposing || e.repeat) return null;
  const t = e.target as HTMLElement | null;
  const tag = t?.tagName;
  const interactive = !!t && (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'A' || t.isContentEditable === true);
  if (e.key === 'Enter') return interactive ? null : 'finish';
  // Esc discards the sketch even from a button (it never activates one); text fields keep it.
  if (e.key === 'Escape') return interactive && tag !== 'BUTTON' && tag !== 'A' ? null : 'cancel';
  return null;
}
