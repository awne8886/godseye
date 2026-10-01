'use client';
/**
 * Warms the code of lazily loaded panels (next/dynamic or React.lazy) before they are opened, so a
 * first open renders its body at once instead of an empty frame while the chunk downloads and
 * evaluates (R1 m9). The tool strip warms a panel on hover/focus, and every registered tool panel
 * one at a time on idle after boot (skipped with Save-Data). Only lazy wrappers are touched: a
 * static component is never called, and anything unrecognised is left to its first render.
 * Owner: design-system-hud.
 */
import type { ComponentType } from 'react';

const REACT_LAZY = Symbol.for('react.lazy');

interface LazyType {
  $$typeof: symbol;
  _payload: unknown;
  _init: (payload: unknown) => unknown;
}

type Loadable = ((props: object) => unknown) & { $$typeof?: symbol; preload?: () => unknown; displayName?: string };

const warmed = new WeakSet<object>();

const isLazy = (t: unknown): t is LazyType =>
  !!t && typeof t === 'object' && (t as LazyType).$$typeof === REACT_LAZY && typeof (t as LazyType)._init === 'function';

/** Start a React.lazy import. React's initialiser throws the pending promise; it handles rejection itself. */
function initLazy(t: LazyType): void {
  try {
    t._init(t._payload);
  } catch (pending) {
    if (pending && typeof (pending as PromiseLike<unknown>).then === 'function') (pending as Promise<unknown>).then(undefined, () => undefined);
  }
}

/** The React.lazy element inside next/dynamic's wrapper tree (Suspense → BailoutToCSR → Lazy). */
function findLazy(node: unknown, depth = 0): LazyType | null {
  if (!node || typeof node !== 'object' || depth > 8) return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findLazy(n, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  const el = node as { type?: unknown; props?: { children?: unknown } };
  if (isLazy(el.type)) return el.type;
  return findLazy(el.props?.children, depth + 1);
}

/**
 * Begin loading a lazily registered component's code; true when a load was started (or had been).
 * next/dynamic in the App Router returns a hook-free `LoadableComponent` wrapper around React.lazy;
 * the Pages variant exposes `preload()`; a bare React.lazy is initialised directly.
 */
export function preloadComponent<P>(comp: ComponentType<P> | null | undefined): boolean {
  if (!comp) return false;
  if (warmed.has(comp)) return true;
  const c = comp as unknown as Loadable;
  if (isLazy(c)) {
    warmed.add(comp);
    initLazy(c);
    return true;
  }
  if (typeof c.preload === 'function') {
    warmed.add(comp);
    void Promise.resolve()
      .then(() => c.preload?.())
      .catch(() => undefined);
    return true;
  }
  if (typeof c === 'function' && c.displayName === 'LoadableComponent') {
    try {
      const lazy = findLazy(c({}));
      if (!lazy) return false;
      warmed.add(comp);
      initLazy(lazy);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

type IdleWindow = Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };

/**
 * Warm `comps` one per idle period (≤ 4 s apart under load). Returns a cancel function. Skipped
 * when the visitor asked to save data.
 */
export function preloadWhenIdle<P>(comps: readonly (ComponentType<P> | null | undefined)[]): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
  if (nav.connection?.saveData) return () => undefined;
  const w = window as IdleWindow;
  const queue = comps.filter((c): c is ComponentType<P> => !!c);
  let handle: number | null = null;
  let cancelled = false;
  const schedule = () => {
    if (cancelled || queue.length === 0) return;
    const run = () => {
      handle = null;
      if (cancelled) return;
      preloadComponent(queue.shift());
      schedule();
    };
    handle = w.requestIdleCallback ? w.requestIdleCallback(run, { timeout: 4000 }) : window.setTimeout(run, 200);
  };
  schedule();
  return () => {
    cancelled = true;
    if (handle === null) return;
    if (w.cancelIdleCallback) w.cancelIdleCallback(handle);
    else window.clearTimeout(handle);
  };
}
