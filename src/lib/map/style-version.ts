/**
 * Theme/Style Studio changes as a version number. The HUD dispatches `godseye:style` on window
 * after it rewrites the CSS custom properties; layers that read `--map-*` tokens (readCssColor)
 * depend on `useStyleVersion()` so they repaint in place, never remounting the map.
 * Owner: map-engine. Unit-tested.
 */
import { useSyncExternalStore } from 'react';

/** Must equal STYLE_EVENT in src/components/hud/style-engine.ts (pinned by a unit test). */
export const MAP_STYLE_EVENT = 'godseye:style';

let version = 0;
const subs = new Set<() => void>();
let listening = false;

function bump(): void {
  version++;
  for (const fn of subs) fn();
}

export function subscribeStyleVersion(fn: () => void): () => void {
  subs.add(fn);
  if (!listening && typeof window !== 'undefined') {
    window.addEventListener(MAP_STYLE_EVENT, bump);
    listening = true;
  }
  return () => {
    subs.delete(fn);
    if (!subs.size && listening && typeof window !== 'undefined') {
      window.removeEventListener(MAP_STYLE_EVENT, bump);
      listening = false;
    }
  };
}

export function getStyleVersion(): number {
  return version;
}

/** Re-renders the caller whenever the HUD announces new style tokens. */
export function useStyleVersion(): number {
  return useSyncExternalStore(subscribeStyleVersion, getStyleVersion, () => 0);
}
