/**
 * Focus layers (visual-qa R4-M1; CI globe first draw): deck entries published by feature-module
 * Backgrounds, keyed by module id (`focusKeysOf`). Today two modules have one: `flight-paths` (the planned
 * route of a `?route=` deep link, or the planned arc of a `?flight=` tracked flight) and
 * `panels-recon` (ReconOverlays: directions routes, drawn shapes, imported ArcGIS layers) — what
 * the user asked for. Not focus (ordinary first-seen admission): the live aircraft track
 * (`aviation`) and the route comet (`flight-paths-anim`), published under other keys. Their start-up units go first in the admission queue (`admission-scheduler.ts`) and
 * wait at most FOCUS_MAX_WAIT_MS for a quiet slot (a software GPU never gives one):
 *  - the deck device is created as soon as a focus layer exists and the globe has drawn its first
 *    frame (ambient data layers still wait for the first painted basemap frame);
 *  - the first class of the focus layers in drawing order (a route's arc: PathLayer) is admitted
 *    first; further focus classes go ahead of ambient classes and native layer types.
 * (The data modules are not queued since perf m-l: they mount at style parse and fetch at once;
 * only their GPU work is queued, behind the basemap's first painted frame.)
 * Measured on SwiftShader before this ordering: the arc's PathLayer came fourth (deck device,
 * feature mount, ScatterplotLayer first because the ambient earthquake layer was seen first), one
 * 2 s deadline each — first draw 16–23 s after style parse.
 *
 * Nothing is skipped and nothing is reported drawn early: every unit stays in `pending` until it is
 * admitted, so the header keeps saying RECEIVED + DRAWING. The keys are registered by the
 * Background host (FeatureLayers.tsx) and the deck host from the feature registry.
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
  /** The deck device otherwise (every deck class needs it first). */
  deckDevice: -1,
  /** Further focus classes. */
  focus: 1,
  /** Ambient deck layer classes and native layer types. */
  ambient: 2,
} as const;

const registered = new Set<string>();

/** Focus keys of a module list: the ids of the modules that have a Background. */
export function focusKeysOf(modules: readonly { id: string; Background?: unknown }[]): string[] {
  return modules.filter((m) => m.Background).map((m) => m.id);
}

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

/**
 * Whether the deck class next in line may be admitted now: focus classes (what the user asked for)
 * at once, ambient data classes only once the basemap has painted (`gpuOpen`, capped) — with a
 * route or flight deep link the other layers' classes must not link programs before it
 * (round-5 perf m-l follow-up).
 */
export function deckClassReady(next: string | undefined, focus: readonly string[], gpuOpen: boolean): boolean {
  return gpuOpen || (!!next && focus.includes(next));
}
