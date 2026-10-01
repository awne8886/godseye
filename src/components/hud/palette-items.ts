'use client';
/**
 * Command palette entries: tools, panels, layers, region presets and map actions (incl. "Dossier
 * at map centre"). Pure over its inputs so the list is unit-tested. Owner: design-system-hud.
 */
import { resolvePlace, routeOrDraft, setPathsDraft } from '@/features/flight-paths/client/draft';
import { KEY_BINDINGS, type KeyAction } from '@/lib/keyboard';
import type { LayerDef, LayerId } from '@/lib/layer-registry';
import { REGION_PRESETS } from '@/lib/presets';
import { PANELS, TOOLS, type PanelId } from '@/lib/tool-registry';
import { useUiStore } from '@/lib/store';
import { parseFlightParam, parseRouteParam } from '@/lib/url-state';
import { mapCentre, runKeyAction } from './actions';

export interface PaletteItem {
  id: string;
  group: 'TOOLS' | 'PANELS' | 'LAYERS' | 'REGIONS' | 'ACTIONS';
  label: string;
  hint?: string;
  keywords: string[];
  run: () => void;
}

/** Panels that need an entity or map context are opened from cards/map gestures, not the palette. */
const CONTEXT_PANELS = new Set<PanelId>(['dossier', 'graph', 'flight-watch', 'camera', 'live-news', 'satellite', 'palette']);

const keyFor = (action: KeyAction) => KEY_BINDINGS.find((b) => b.action === action)?.display;

/** A typed route: airport codes, or place names resolved through /api/airports/search on run. */
export type RouteQuery = { kind: 'codes'; from: string; to: string } | { kind: 'names'; from: string; to: string };

/** IATA/ICAO-shaped (3–4 alphanumerics) or a longer OurAirports ident that contains a digit. */
const looksLikeCode = (s: string) => /^[A-Z0-9]{3,4}$/.test(s) || (/\d/.test(s) && /^[A-Z0-9]{3,8}$/.test(s));

/**
 * Whole-phrase non-places: a side of "X to Y" that is exactly one of these is never a city
 * ("me to paris", "map to 3d", "from to rome").
 */
const NOT_A_PLACE = new Set([
  'go', 'fly', 'zoom', 'pan', 'jump', 'move', 'navigate', 'take', 'take me', 'bring', 'bring me', 'show', 'show me', 'switch', 'change',
  'set', 'toggle', 'turn', 'head', 'travel', 'goto', 'centre', 'center', 'scroll', 'rotate', 'tilt', 'back', 'return', 'snap', 'route',
  'plan', 'directions', 'from', 'me', 'up', 'down', 'how', 'way', 'path', 'next', 'add', 'map', 'globe', 'view', 'camera', 'here', 'there',
]);
/** Continents and other areas that never resolve to one airport. */
const AREAS = new Set(['europe', 'asia', 'africa', 'america', 'north america', 'south america', 'oceania', 'antarctica', 'arctic', 'the world', 'world', 'middle east', 'pacific', 'atlantic', 'globe', 'satellite', 'satellites', 'map', 'mercator', '2d', '3d']);

type Phrase = readonly string[];
const phrases = (...p: string[]): Phrase[] => p.map((s) => s.split(' '));

/**
 * Politeness and discourse words that only ever open a command, stripped as whole leading phrases
 * ("please …", "can you …", "now …", "hey …", "I need to …"). Never a single word that also starts a
 * place name: "Can Tho" and "In Salah" keep their first word because "can" and "in" alone are not
 * fillers (round 4 m4). The discourse fillers (round 5 M1) make "now go to rome" and "I need to
 * drive to paris" read as "go to rome" / "drive to paris": commands, never routes.
 */
const LEAD_FILLERS = phrases(
  'please', 'pls', 'kindly', 'can you', 'could you', 'would you', 'will you', 'can i', 'could i', 'i want to', 'i wanna',
  "i'd like to", 'i would like to', "let's", 'lets', 'let me', 'let us',
  'now', 'just', 'then', 'ok', 'okay', 'hey', 'so', 'and', 'also', 'quickly', 'right now',
  'i need to', 'we need to', 'i have to', 'we have to', 'i must', 'we must', 'i should', 'we should', 'shall we', 'should we',
  'i gotta', 'gotta', "i'm going to", 'i am going to', "we're going to", 'we are going to', 'i will', "i'll", 'we will', "we'll",
  'time to', "it's time to", 'how do i get to', 'how do we get to', 'how can i get to', 'how do i go to', 'how to get to',
);
/** Politeness at the very end of the destination ("London to Paris please"). */
const TRAIL_FILLERS = phrases('please', 'pls', 'thanks', 'thank you');

/** Verbs that ask for a flight route; "from" may follow ("fly from Can Tho to Hanoi"). */
const FLIGHT_VERBS = phrases(
  'fly', 'flight', 'flights', 'route', 'plan', 'plan route', 'plan a route', 'plan the route', 'plan flight', 'plan a flight',
  'flight path', 'flight route', 'find flights', 'find a flight',
);
/**
 * Navigation, UI and ground-travel verbs: as the FIRST word they make the phrase a command, never a
 * flight ("drive to paris" must not plan Brive → Paris, "zoom in to kyiv" moves the camera).
 */
const COMMAND_VERBS = phrases(
  'go', 'goto', 'show', 'head', 'pan', 'centre', 'center', 'back', 'view', 'look', 'turn', 'travel',
  'zoom', 'jump', 'move', 'navigate', 'take', 'bring', 'get', 'send', 'switch', 'change', 'set', 'toggle', 'open', 'close',
  'scroll', 'rotate', 'tilt', 'return', 'snap', 'teleport', 'focus', 'directions',
  'drive', 'walk', 'ride', 'cycle', 'bike', 'hike', 'run', 'sail', 'swim', 'commute', 'cruise',
);
/** Every word that opens a command or a flight request. */
const VERB_WORDS: ReadonlySet<string> = new Set([...COMMAND_VERBS, ...FLIGHT_VERBS].map((p) => p[0]!));
/**
 * Command verbs that also begin real place names: followed directly by another word they are part
 * of the name ("Show Low" — SOW, Arizona; "Center Island"; "Snap Lake"), not a command. Alone or
 * followed only by particles ("show me", "head over", "go back") they are still commands.
 */
const PLACE_PREFIX_VERBS = new Set(['go', 'show', 'head', 'pan', 'centre', 'center', 'back', 'view', 'look', 'turn', 'travel', 'snap']);
/**
 * Command verbs that also END real place names in the bundled airport data ("Hilton Head", "Mountain
 * View", "Orange Walk", "Copper Center", "Frying Pan Island"). Anywhere else after the first word a
 * verb means the phrase is speech ("now go", "hey fly", "how do i get"), not a name (round 5 M1).
 */
const PLACE_SUFFIX_VERBS = new Set(['head', 'view', 'centre', 'center', 'walk', 'pan', 'run']);
/** Pronouns, modals and discourse words: a verb right after one of them is speech, not a name ("we head"). */
const CONVERSATIONAL = new Set([
  'i', "i'm", 'we', "we're", 'you', 'me', 'us', 'they', 'should', 'need', 'needs', 'must', 'want', 'wanna', 'gotta', 'gonna',
  'have', 'has', 'do', 'does', 'did', 'can', 'could', 'would', 'will', 'shall', 'may', 'might', 'let', "let's", 'lets', 'now',
  'just', 'then', 'ok', 'okay', 'hey', 'so', 'quickly', 'please', 'pls', 'time', 'how', 'to', 'and', 'also',
]);
/** Words that may follow a command verb without naming a place ("zoom in", "take me", "head over"). */
const PARTICLES = new Set([
  'me', 'us', 'in', 'out', 'over', 'back', 'up', 'down', 'around', 'along', 'on', 'off', 'there', 'now', 'please', 'straight',
  'right', 'again', 'quickly', 'ahead', 'across', 'away', 'the', 'a',
]);
/** Route separators: a name never contains one ("London to New York to Paris" is not a two-point route). */
const SEPARATORS = new Set(['to', 'from', '→', '->', '>']);

/** Lower-case, apostrophe-folded word without trailing punctuation, for matching (the original word is kept). */
const norm = (w: string) =>
  w
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[,.!?;:]+$/, '');

/** Length of the longest phrase that starts at word `i`, else 0. */
function phraseAt(words: readonly string[], i: number, list: readonly Phrase[]): number {
  let best = 0;
  for (const p of list) if (p.length > best && p.every((w, k) => words[i + k] === w)) best = p.length;
  return best;
}

/** Index of the first word at or after `i` that is not in `set`. */
function skipWords(words: readonly string[], i: number, set: ReadonlySet<string>): number {
  while (i < words.length && set.has(words[i]!)) i++;
  return i;
}

/** The query without leading politeness phrases (whole words only). */
function stripLeadFillers(q: string): string {
  const raw = q.split(/\s+/);
  const w = raw.map(norm);
  let i = 0;
  for (let n = phraseAt(w, 0, LEAD_FILLERS); n && i + n < w.length; n = phraseAt(w, i, LEAD_FILLERS)) i += n;
  return raw.slice(i).join(' ');
}

/** The destination without trailing politeness ("Paris please" → "Paris"). */
function stripTrailFillers(s: string): string {
  const raw = s.split(/\s+/);
  const w = raw.map(norm);
  for (const p of TRAIL_FILLERS) {
    const at = w.length - p.length;
    if (at > 0 && phraseAt(w, at, [p]) === p.length) return raw.slice(0, at).join(' ');
  }
  return s;
}

/** One token typed in capitals as an airport code ("RUN", "GET", "EGLL"): never read as a verb. */
const capsCode = (raw: readonly string[]) => raw.length === 1 && /^[A-Z0-9]{3,4}$/.test(raw[0]!);

/**
 * Whether normalised words can be a place name rather than speech (round 5 M1). A command verb may
 * open a name only as a place prefix followed by a real word ("Show Low"), and appear later only as
 * a known place suffix after a non-conversational word ("Hilton Head", "Mountain View"). Any other
 * verb ("now go", "hey fly", "drive to paris") or a route separator ("New York to Paris") means the
 * words are a command or a multi-leg request, never one place.
 */
export function isPlaceName(n: readonly string[]): boolean {
  if (n.length === 0) return false;
  const first = n[0]!;
  if (VERB_WORDS.has(first)) {
    const next = n[1];
    if (!PLACE_PREFIX_VERBS.has(first) || next === undefined || PARTICLES.has(next) || SEPARATORS.has(next) || VERB_WORDS.has(next)) return false;
  }
  for (let k = 1; k < n.length; k++) {
    const x = n[k]!;
    if (SEPARATORS.has(x)) return false;
    if (!VERB_WORDS.has(x)) continue;
    const next = n[k + 1];
    const endsName = next === undefined || !(PARTICLES.has(next) || SEPARATORS.has(next));
    if (!(PLACE_SUFFIX_VERBS.has(x) && !CONVERSATIONAL.has(n[k - 1]!) && endsName)) return false;
  }
  return true;
}

/**
 * The origin named by the left side of "X to Y", or null when the left side is a command.
 * Position-aware (round 4 m4, round 5 M1): a command verb opens a command only as the first word,
 * particles count only right after it, words are never removed from inside a name, and what is left
 * must pass isPlaceName — "fly from Can Tho" → "Can Tho", "Show Low" → "Show Low", "Hilton Head" →
 * "Hilton Head"; "drive" / "zoom in" / "head over" / "show me" / "now go" / "hey fly" → null.
 */
export function originOf(left: string): string | null {
  const raw = left.trim().split(/\s+/).filter(Boolean);
  if (capsCode(raw)) return raw[0]!;
  const w = raw.map(norm);
  let i = 0;
  const verb = phraseAt(w, 0, COMMAND_VERBS);
  if (verb) {
    const j = skipWords(w, verb, PARTICLES);
    if (j === w.length) return null; // "go", "zoom in", "head over", "get me", "drive"
    // "Show Low": the verb is the first word of the name. "drive from…", "show me rome" are commands.
    if (!phraseAt(w, j, FLIGHT_VERBS)) return isPlaceName(w) ? raw.join(' ') : null;
    i = j; // "show me flights from …"
  }
  const flight = phraseAt(w, i, FLIGHT_VERBS);
  if (flight) {
    i = skipWords(w, i + flight, new Set(['me', 'us']));
    if (w[i] === 'from') i++;
  } else if (w[0] === 'from') i = 1;
  // "fly to paris", "plan a route to rome": a destination without an origin is navigation.
  if (i >= w.length) return null;
  const name = raw.slice(i);
  return capsCode(name) || isPlaceName(w.slice(i)) ? name.join(' ') : null;
}

/** The destination of "X to Y" without trailing politeness, or null when it is a command ("… to drive to paris"). */
export function destinationOf(right: string): string | null {
  const to = stripTrailFillers(right.trim());
  const raw = to.split(/\s+/).filter(Boolean);
  if (capsCode(raw)) return to;
  return isPlaceName(raw.map(norm)) ? to : null;
}

/**
 * A code as typed: 3-character codes in any case ("lhr"), but a 4-letter word only when typed in
 * capitals ("EGLL"), so "Rome" or "Kyiv" are place names, not ICAO idents.
 */
function typedCode(s: string): boolean {
  const U = s.toUpperCase();
  if (!looksLikeCode(U)) return false;
  return U.length !== 4 || /\d/.test(U) || s === U;
}

/** A place name the airport search can resolve: letters (any script), spaces, . ' -; ≥ 3 letters. */
export function looksLikePlace(s: string): boolean {
  const v = s.trim().toLowerCase().replace(/\s+/g, ' ');
  if (NOT_A_PLACE.has(v) || AREAS.has(v)) return false;
  if (!/^[\p{L}][\p{L}\p{M} .'’-]*$/u.test(v)) return false;
  return (v.match(/\p{L}/gu)?.length ?? 0) >= 3;
}

/**
 * "LHR JFK", "EGLL→KJFK", "LHR-JFK", "LHR to JFK" → codes; "London to New York", "Paris → Tokyo",
 * "fly from Can Tho to Hanoi" → names, only when both sides look like places and the left side is
 * not a command (m6: "go to paris", "fly to europe"; round 4 m4: "drive to paris"; round 5 M1: "now
 * go to rome", "I need to drive to paris", "how do i get to paris"). Anything else (a single word,
 * "satellites", a multi-leg "A to B to C") → null.
 */
export function parseRouteQuery(query: string): RouteQuery | null {
  const q = stripLeadFillers(query.trim());
  if (!q) return null;
  const words = q.match(/^(.+?)\s+(?:to|→|->|>)\s+(.+)$/i) ?? q.match(/^(.+?)\s*(?:→|->)\s*(.+)$/);
  if (words) {
    const from = originOf(words[1]!);
    const to = destinationOf(words[2]!);
    if (!from || !to || from.toLowerCase() === to.toLowerCase()) return null;
    if (typedCode(from) && typedCode(to)) return { kind: 'codes', from: from.toUpperCase(), to: to.toUpperCase() };
    if (from.length > 60 || to.length > 60) return null;
    const fromOk = typedCode(from) || looksLikePlace(from);
    const toOk = typedCode(to) || looksLikePlace(to);
    return fromOk && toOk ? { kind: 'names', from, to } : null;
  }
  const r = parseRouteParam(q);
  return r && looksLikeCode(r.from) && looksLikeCode(r.to) ? { kind: 'codes', ...r } : null;
}

/** Hyphenated civil registrations (G-XWBA, VH-OQA, D-AIMA) and 24-bit ICAO hex (4CA2B3). */
const REGISTRATION_RE = /^[A-Z]{1,2}-[A-Z0-9]{2,5}$/;
const HEX_RE = /^[0-9A-F]{6}$/;

/** A typed flight ident: needs a digit (callsign, flight number, N-number), a registration or a hex. */
export function parseFlightQuery(query: string): string | null {
  const v = query.trim().toUpperCase();
  if (!(/\d/.test(v) || REGISTRATION_RE.test(v) || HEX_RE.test(v))) return null;
  return parseFlightParam(v);
}

/**
 * Items derived from what the visitor typed: a route (codes or place names) plans it; a callsign,
 * flight number, registration or hex tracks a flight. Both open the PATHS panel.
 */
export function queryItems(query: string, available: (id: PanelId) => boolean, fetchImpl?: typeof fetch): PaletteItem[] {
  if (!available('paths')) return [];
  const ui = () => useUiStore.getState();
  const q = query.trim();
  const out: PaletteItem[] = [];
  const route = parseRouteQuery(q);
  if (route?.kind === 'codes') {
    out.push({
      id: `route:${route.from}-${route.to}`,
      group: 'ACTIONS',
      label: `Plan route ${route.from} → ${route.to}`,
      keywords: [q, 'route', 'plan', 'flight path'],
      run: () => {
        ui().setFlightIdent(null);
        ui().setPlannedRoute({ from: route.from, to: route.to });
        ui().setOpenPanel('paths');
      },
    });
  } else if (route?.kind === 'names') {
    out.push({
      id: `route-names:${route.from}|${route.to}`,
      group: 'ACTIONS',
      label: `Plan route ${route.from.toUpperCase()} → ${route.to.toUpperCase()}`,
      // An honest hint: the search's best match is not always a city's main airport (R4 B2).
      hint: 'Best airport match for each name; check and switch airports in PATHS',
      keywords: [q, 'route', 'plan', 'flight path'],
      run: () => {
        ui().setOpenPanel('paths');
        void Promise.all([resolvePlace(route.from, fetchImpl), resolvePlace(route.to, fetchImpl)]).then(([a, b]) => {
          const { route: planned, draft } = routeOrDraft(route.from, route.to, a, b);
          if (planned) {
            setPathsDraft(null);
            ui().setFlightIdent(null);
            ui().setPlannedRoute(planned);
          } else if (draft) {
            // Tell the planner which names did not resolve (or whose search failed) instead of failing silently.
            setPathsDraft(draft);
          }
        });
      },
    });
  }
  const flight = route ? null : parseFlightQuery(q);
  if (flight) {
    out.push({
      id: `flight:${flight}`,
      group: 'ACTIONS',
      label: `Track flight ${flight}`,
      keywords: [q, 'flight', 'track', 'callsign', 'registration'],
      run: () => {
        ui().setFlightIdent(flight);
        ui().setOpenPanel('paths');
      },
    });
  }
  return out;
}

/** Exact label, or the label without its verb ("Show Flights" for "flights", "Fly to Europe" for "europe"). */
function exactLabel(label: string, s: string): boolean {
  const l = label.toLowerCase();
  return l === s || l.replace(/^(show|hide|fly to|toggle)\s+/, '') === s;
}

/**
 * cmdk ranking over its fuzzy score (m6, n1): exact command labels first ("LAYERS" opens the
 * LAYERS panel, "SETTINGS" opens SETTINGS), then typed airport-code routes and flight idents, then
 * place-name routes, then label prefixes, then everything else by fuzzy score. 0 hides the item.
 */
export function rankItem(item: Pick<PaletteItem, 'id' | 'label'>, search: string, fuzzy: number): number {
  const s = search.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return 1;
  if (exactLabel(item.label, s)) return 1;
  if (item.id.startsWith('route:') || item.id.startsWith('flight:')) return 0.97;
  if (item.id.startsWith('route-names:')) return 0.95;
  if (fuzzy <= 0) return 0;
  const f = Math.min(fuzzy, 1);
  if (item.label.toLowerCase().startsWith(s)) return 0.9 + f * 0.04;
  return f * 0.89;
}

/**
 * The item Enter runs for `search` when the visitor has not moved the selection: the best-ranked
 * item of the current query (ties keep list order). Computed from the query itself, so a fast
 * typist never runs the stale top item of a previous keystroke (n1).
 */
export function topItem<T extends Pick<PaletteItem, 'id' | 'label' | 'keywords'>>(
  items: readonly T[],
  search: string,
  fuzzy: (value: string, search: string, keywords: string[]) => number,
): T | null {
  let best: T | null = null;
  let bestScore = 0;
  for (const i of items) {
    const score = rankItem(i, search, fuzzy(`${i.label} ${i.id}`, search, i.keywords));
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  }
  return best;
}

export function paletteItems(ctx: { available: (id: PanelId) => boolean; layers: LayerDef[]; active: ReadonlySet<string> }): PaletteItem[] {
  const ui = () => useUiStore.getState();
  const items: PaletteItem[] = [];
  for (const t of TOOLS) {
    if (!ctx.available(t.id)) continue;
    items.push({ id: `tool:${t.id}`, group: 'TOOLS', label: t.label, hint: t.tooltip, keywords: [t.id, t.tooltip], run: () => ui().setOpenPanel(t.id) });
  }
  for (const p of PANELS) {
    if (CONTEXT_PANELS.has(p.id) || !ctx.available(p.id)) continue;
    items.push({ id: `panel:${p.id}`, group: 'PANELS', label: p.label, keywords: [p.id], run: () => ui().setOpenPanel(p.id) });
  }
  for (const l of ctx.layers) {
    const on = ctx.active.has(l.id);
    items.push({
      id: `layer:${l.id}`,
      group: 'LAYERS',
      label: `${on ? 'Hide' : 'Show'} ${l.label}`,
      hint: l.description,
      keywords: [l.id, l.group, 'layer', 'toggle'],
      run: () => ui().toggleLayer(l.id as LayerId),
    });
  }
  for (const r of REGION_PRESETS) {
    items.push({
      id: `region:${r.id}`,
      group: 'REGIONS',
      label: `Fly to ${r.label}`,
      keywords: [r.id, 'region', 'preset', 'fly'],
      run: () => ui().requestFlyTo({ lat: r.lat, lng: r.lng, zoom: r.zoom }),
    });
  }
  items.push(
    { id: 'action:dossier', group: 'ACTIONS', label: 'Dossier at map centre', keywords: ['dossier', 'region', 'brief', 'centre', 'center'], run: () => ui().openDossier(mapCentre()) },
    { id: 'action:projection', group: 'ACTIONS', label: 'Toggle globe / flat map', hint: keyFor('toggle-projection'), keywords: ['globe', '2d', '3d', 'projection'], run: () => runKeyAction('toggle-projection') },
    { id: 'action:reset', group: 'ACTIONS', label: 'Reset view', hint: keyFor('reset-view'), keywords: ['home', 'reset'], run: () => runKeyAction('reset-view') },
    { id: 'action:fullscreen', group: 'ACTIONS', label: 'Toggle fullscreen', hint: keyFor('toggle-fullscreen'), keywords: ['fullscreen'], run: () => runKeyAction('toggle-fullscreen') },
    { id: 'action:basemap', group: 'ACTIONS', label: 'Toggle satellite imagery', keywords: ['sat', 'imagery', 'basemap', 'map'], run: () => ui().setBasemap(ui().basemap === 'dark' ? 'satellite' : 'dark') },
    { id: 'action:ghost', group: 'ACTIONS', label: 'Toggle Ghost Protocol', keywords: ['ghost', 'theme', 'violet'], run: () => ui().setGhost(!ui().ghost) },
    { id: 'action:sensor-crt', group: 'ACTIONS', label: 'Sensor mode: CRT', hint: keyFor('sensor-crt'), keywords: ['sensor', 'crt'], run: () => runKeyAction('sensor-crt') },
    { id: 'action:sensor-nvg', group: 'ACTIONS', label: 'Sensor mode: NVG', hint: keyFor('sensor-nvg'), keywords: ['sensor', 'night', 'nvg'], run: () => runKeyAction('sensor-nvg') },
    { id: 'action:sensor-flir', group: 'ACTIONS', label: 'Sensor mode: FLIR', hint: keyFor('sensor-flir'), keywords: ['sensor', 'thermal', 'flir'], run: () => runKeyAction('sensor-flir') },
    { id: 'action:sensor-noir', group: 'ACTIONS', label: 'Sensor mode: Noir', hint: keyFor('sensor-noir'), keywords: ['sensor', 'noir', 'mono'], run: () => runKeyAction('sensor-noir') },
    { id: 'action:sensor-none', group: 'ACTIONS', label: 'Sensor mode: off', hint: keyFor('sensor-none'), keywords: ['sensor', 'off'], run: () => runKeyAction('sensor-none') },
  );
  return items;
}
