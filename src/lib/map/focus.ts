/**
 * Focus layers (visual-qa R4-M1; CI globe first draw): deck entries published by module
 * Backgrounds — the user's own planned route, tracked flight or drawn shapes, i.e. what the user
 * asked for. Their start-up units go first in the admission queue (`admission-scheduler.ts`) and
 * wait at most FOCUS_MAX_WAIT_MS for a quiet slot (a software GPU never gives one):
 *  - the deck device is created as soon as a focus layer exists and the globe has drawn its first
 *    frame (ambient data layers still wait for the first painted basemap frame);
 *  - the first class of the focus layers in drawing order (a route's arc: PathLayer) is admitted
 *    before the data modules mount; further focus classes go after that mount but ahead of ambient
 *    classes and native layer types.
 * Measured on SwiftShader before this ordering: the arc's PathLayer came fourth (deck device,
 * feature mount, ScatterplotLayer first because the ambient earthquake layer was seen first), one
 * 2 s deadline each — first draw 16–23 s after style parse.
 *
 * Nothing is skipped and nothing is reported drawn early: every unit stays in `pending` until it is
 * admitted, so the header keeps saying RECEIVED + DRAWING. The keys are registered by the
 * Background host (FeatureBackgrounds), so the map chunk never imports the feature registry.
 * Owner: map-engine. Pure and unit-tested.
 */
import { FOCUS_MAX_WAIT_MS } from './admission-scheduler';
import { type AdmissionLayer, flattenLayers, layerClassKey } from './deck-admission';

interface EntryLike {
  layers: unknown;
  z: number;
}
type Entries = Readonly<Record<string, EntryLike>>;

/** Admission priorities, lower first (equal priorities alternate). */
export const ADMISSION_PRIORITY = {
  /** The deck device while focus layers exist, and the first focus class. */
  focusFirst: -2,
  /** The deck device while only Background layers exist and the data modules have not mounted. */
  deckDevice: -1,
  /** Mounting the data modules (their fetch, parse and publish). */
  features: 0,
  /** Further focus classes; the deck device once the data modules have mounted. */
  focus: 1,
  /** Ambient deck layer classes and native layer types. */
  ambient: 2,
} as const;

const registered = new Set<string>();

/** Deck entry keys published by module Backgrounds (registered by the Background host). */
export function registerFocusKeys(keys: Iterable<string>): void {
  for (const k of keys) registered.add(k);
}

function focusLayers(entries: Entries, keys: ReadonlySet<string>): AdmissionLayer[] {
  return Object.entries(entries)
    .filter(([key]) => keys.has(key))
    .sort((a, b) => a[1].z - b[1].z)
    .flatMap(([, e]) => flattenLayers<AdmissionLayer>([e.layers]));
}

/** Classes of the focus layers in drawing order (entries by z, then each entry's own order), no duplicates. */
export function focusClassOrder(entries: Entries, keys: ReadonlySet<string> = registered): string[] {
  const out: string[] = [];
  for (const l of focusLayers(entries, keys)) {
    const c = layerClassKey(l);
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

/** True while a focus entry holds a visible layer: the deck device is then wanted early. */
export function hasFocusLayers(entries: Entries, keys: ReadonlySet<string> = registered): boolean {
  return focusLayers(entries, keys).some((l) => l.props.visible !== false);
}

/** Priority of the deck-classes unit for the class next in line (`focus` from `focusClassOrder`). */
export function deckClassPriority(next: string | undefined, focus: readonly string[]): number {
  if (!next || !focus.includes(next)) return ADMISSION_PRIORITY.ambient;
  return next === focus[0] ? ADMISSION_PRIORITY.focusFirst : ADMISSION_PRIORITY.focus;
}

/** Longest wait for a quiet slot for the class next in line: short for focus classes, else the default. */
export function deckClassMaxWait(next: string | undefined, focus: readonly string[]): number | undefined {
  return next && focus.includes(next) ? FOCUS_MAX_WAIT_MS : undefined;
}
