/**
 * The map host's pointer-move work (MapView): the cursor readout on every animation frame, and
 * the host's hover pick (deck's own hover result + native features + every CPU hit-tester) for the
 * pointer cursor through the same budget as deck's GPU hover pick (`createHoverPickGate`): at most
 * one pick per HOVER_PICK_MIN_INTERVAL_MS and ≤ HOVER_PICK_MAX_DUTY of the main thread while the
 * pointer moves, one trailing pick where it comes to rest, none while a button is held, the camera
 * moves or a map tool is armed, and none in the double-click window after a press.
 *
 * Verification round 8 (perf): the CPU hit-testers ran on every frame the pointer moved. With the
 * recorded aircraft snapshot (9,228 drawn) and live satellites (8,998 drawn) the host's hover
 * callback took 33 ms (median, 52 ms p90) of thread time per frame — twice the frame budget before
 * MapLibre or deck drew anything. The readout stays per frame (cheap DOM writes); the pick no longer
 * is. Owner: map-engine. Pure (injected frame and timer sources), unit-tested.
 */
import { normalizeLng } from '@/lib/geo';
import { createHoverPickGate, type HoverPickTimers } from './hover-pick';

export interface HostHoverFrames {
  request(cb: () => void): unknown;
  cancel(id: unknown): void;
}

export interface HostHoverOptions {
  /** requestAnimationFrame / cancelAnimationFrame. */
  frames: HostHoverFrames;
  timers: HoverPickTimers;
  /** Cursor readout (zero-render DOM writes, `publishCursor`); null when the pointer left the map. */
  cursor(c: { lng: number; lat: number; zoom: number } | null): void;
  zoom(): number;
  /** Hover pick at (x, y): is anything selectable under the pointer? */
  pick(x: number, y: number): boolean;
  /** The hover verdict (the canvas pointer cursor); false when the pointer left or a tool is armed. */
  pointer(hit: boolean): void;
  /** The camera is moving (fly, ease, drag). */
  moving(): boolean;
  /** A map tool (DRAW) owns the pointer: no hover picks, no pointer cursor. */
  suspended(): boolean;
  minIntervalMs?: number;
  settleMs?: number;
}

export interface HostHoverMove {
  x: number;
  y: number;
  lng: number;
  lat: number;
  /** MouseEvent.buttons: any held button blocks the hover pick (drag, rotate, right-press). */
  buttons?: number;
}

export interface HostHover {
  move(e: HostHoverMove): void;
  /** The pointer left the map. */
  leave(): void;
  /** A button went down or up (the hover yields to the double-click window). */
  press(): void;
  /** The camera started moving under a resting pointer: drop the pending trailing pick. */
  cameraMoveStart(): void;
  /** Hover picks run so far (diagnostics). */
  picks(): number;
  dispose(): void;
}

export function createHostHover(o: HostHoverOptions): HostHover {
  let frame: unknown = null;
  let disposed = false;
  const gate = createHoverPickGate({
    pick: (x, y) => {
      const t0 = o.timers.now();
      o.pointer(o.pick(x, y));
      return o.timers.now() - t0;
    },
    leave: () => o.pointer(false),
    timers: o.timers,
    minIntervalMs: o.minIntervalMs,
    settleMs: o.settleMs,
    suspended: () => o.suspended(),
  });
  const cancelFrame = () => {
    if (frame !== null) o.frames.cancel(frame);
    frame = null;
  };
  return {
    move(e) {
      if (disposed) return;
      // One update per animation frame, at the latest position.
      cancelFrame();
      frame = o.frames.request(() => {
        frame = null;
        if (disposed) return;
        o.cursor({ lng: normalizeLng(e.lng), lat: e.lat, zoom: o.zoom() });
        gate.move(e.x, e.y, !!e.buttons || o.moving());
      });
    },
    leave() {
      if (disposed) return;
      cancelFrame();
      gate.leave();
      o.cursor(null);
    },
    press() {
      if (!disposed) gate.press();
    },
    cameraMoveStart() {
      if (!disposed) gate.move(Number.NaN, Number.NaN, true);
    },
    picks: () => gate.picks(),
    dispose() {
      disposed = true;
      cancelFrame();
      gate.dispose();
    },
  };
}
