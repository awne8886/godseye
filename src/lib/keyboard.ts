/**
 * The one keyboard map. The global key handler AND the help overlay both read this list,
 * so they cannot disagree (OSIRIS's overlay said S = share while S opened search).
 * Owner: lead. design-system-hud implements the handler and overlay from this data.
 */

export type KeyAction =
  | 'toggle-fullscreen'
  | 'open-share'
  | 'toggle-layers'
  | 'toggle-markets'
  | 'toggle-intel'
  | 'reset-view'
  | 'toggle-projection'
  | 'toggle-paths'
  | 'open-help'
  | 'close'
  | 'open-palette'
  | 'open-search'
  | 'sensor-crt'
  | 'sensor-nvg'
  | 'sensor-flir'
  | 'sensor-noir'
  | 'sensor-none';

export interface KeyBinding {
  action: KeyAction;
  /** `key` values as in KeyboardEvent.key (case-insensitive for letters). */
  keys: readonly string[];
  /** Requires Ctrl (Windows/Linux) or ⌘ (macOS). */
  mod?: boolean;
  /** Label shown in the help overlay, e.g. "⌘K / Ctrl-K / /". */
  display: string;
  description: string;
  /** Still fires while focus is in a text field. */
  allowInInput?: boolean;
}

export const KEY_BINDINGS = [
  { action: 'toggle-fullscreen', keys: ['f'], display: 'F', description: 'Toggle fullscreen' },
  { action: 'open-share', keys: ['s'], display: 'S', description: 'Share current view' },
  { action: 'toggle-layers', keys: ['l'], display: 'L', description: 'Layers' },
  { action: 'toggle-markets', keys: ['m'], display: 'M', description: 'Markets' },
  { action: 'toggle-intel', keys: ['i'], display: 'I', description: 'Intel feed' },
  { action: 'reset-view', keys: ['r'], display: 'R', description: 'Reset view' },
  { action: 'toggle-projection', keys: ['g'], display: 'G', description: 'Globe / flat map' },
  { action: 'toggle-paths', keys: ['p'], display: 'P', description: 'Flight paths' },
  { action: 'open-help', keys: ['?'], display: '?', description: 'Keyboard shortcuts' },
  { action: 'close', keys: ['Escape'], display: 'ESC', description: 'Close panel / cancel', allowInInput: true },
  { action: 'open-palette', keys: ['k'], mod: true, display: '⌘K / Ctrl-K', description: 'Command palette', allowInInput: true },
  { action: 'open-palette', keys: ['/'], display: '/', description: 'Command palette' },
  { action: 'open-search', keys: ['f'], mod: true, display: '⌘F / Ctrl-F', description: 'Search locations', allowInInput: true },
  { action: 'sensor-crt', keys: ['1'], display: '1', description: 'Sensor mode: CRT' },
  { action: 'sensor-nvg', keys: ['2'], display: '2', description: 'Sensor mode: NVG' },
  { action: 'sensor-flir', keys: ['3'], display: '3', description: 'Sensor mode: FLIR' },
  { action: 'sensor-noir', keys: ['4'], display: '4', description: 'Sensor mode: Noir' },
  { action: 'sensor-none', keys: ['0'], display: '0', description: 'Sensor mode: off' },
] as const satisfies readonly KeyBinding[];

export interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  /** Auto-repeat from a held key. */
  repeat?: boolean;
  /** IME composition in progress (CJK input etc.). */
  isComposing?: boolean;
}

/** Resolve a keydown to an action. Returns null when nothing matches or focus is in a field. */
export function matchBinding(e: KeyEventLike, inTextField: boolean): KeyAction | null {
  if (e.altKey || e.repeat || e.isComposing) return null;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  for (const b of KEY_BINDINGS as readonly KeyBinding[]) {
    if (Boolean(b.mod) !== mod) continue;
    if (!b.keys.some((k) => k === key || (k.length === 1 && k === e.key))) continue;
    if (inTextField && !b.allowInInput) continue;
    return b.action;
  }
  return null;
}

/**
 * Keys of the 24 h timeline slider (TimelineScrubber's `cursorForKey`), active only while the slider
 * has focus; listed here so the Help panel shows them next to the global map. Not global bindings.
 */
export const TIMELINE_KEYS = [
  { display: '← / →', description: 'Step the timeline 15 min back / forward' },
  { display: 'Shift+← / → · PgUp / PgDn', description: 'Step the timeline 1 h' },
  { display: 'Home', description: 'Replay from 24 h ago' },
  { display: 'End / ESC', description: 'Back to live' },
] as const satisfies readonly { display: string; description: string }[];
