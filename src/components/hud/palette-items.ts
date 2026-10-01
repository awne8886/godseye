'use client';
/**
 * Command palette entries: tools, panels, layers, region presets and map actions (incl. "Dossier
 * at map centre"). Pure over its inputs so the list is unit-tested. Owner: design-system-hud.
 */
import { setPathsDraft } from '@/features/flight-paths/client/draft';
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
 * Words that make "X to Y" a navigation or command phrase rather than a city pair: "go to paris",
 * "fly to europe", "zoom to kyiv", "switch to satellite", "take me to rome".
 */
const NOT_A_PLACE = new Set([
  'go', 'fly', 'zoom', 'pan', 'jump', 'move', 'navigate', 'take', 'take me', 'bring', 'bring me', 'show', 'show me', 'switch', 'change',
  'set', 'toggle', 'turn', 'head', 'travel', 'goto', 'centre', 'center', 'scroll', 'rotate', 'tilt', 'back', 'return', 'snap', 'route',
  'plan', 'directions', 'from', 'me', 'up', 'down', 'how', 'way', 'path', 'next', 'add', 'map', 'globe', 'view', 'camera',
]);
/** Filler words that only occur in commands, never in a place name on the left of "to". */
const COMMAND_FILLERS = new Set(['please', 'in', 'out', 'let', 'lets', "let's", 'now', 'can', 'you', 'i', 'want']);
/** Continents and other areas that never resolve to one airport. */
const AREAS = new Set(['europe', 'asia', 'africa', 'america', 'north america', 'south america', 'oceania', 'antarctica', 'arctic', 'the world', 'world', 'middle east', 'pacific', 'atlantic', 'globe', 'satellite', 'satellites', 'map', 'mercator', '2d', '3d']);

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
 * "LHR JFK", "EGLL→KJFK", "LHR-JFK", "LHR to JFK" → codes; "London to New York", "Paris → Tokyo"
 * → names, only when both sides look like places (m6: "go to paris", "fly to europe" are not
 * routes). Anything else (a single word, "satellites") → null.
 */
export function parseRouteQuery(query: string): RouteQuery | null {
  const q = query.trim();
  if (!q) return null;
  const words = q.match(/^(.+?)\s+(?:to|→|->|>)\s+(.+)$/i) ?? q.match(/^(.+?)\s*(?:→|->)\s*(.+)$/);
  if (words) {
    const from = words[1]!.trim();
    const to = words[2]!.trim();
    if (from.toLowerCase() === to.toLowerCase()) return null;
    const fromKey = from.toLowerCase().replace(/\s+/g, ' ');
    // "zoom in to paris", "please go to rome": any command word on the left makes it a command.
    if (NOT_A_PLACE.has(fromKey) || fromKey.split(' ').some((w) => NOT_A_PLACE.has(w) || COMMAND_FILLERS.has(w))) return null;
    const F = from.toUpperCase();
    const T = to.toUpperCase();
    if (typedCode(from) && typedCode(to)) return { kind: 'codes', from: F, to: T };
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

/** One airport code for a place name: the metro group's first airport, else the best match. */
export async function resolveAirport(name: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const r = await fetchImpl(`/api/airports/search?q=${encodeURIComponent(name)}&submit=1`);
    if (!r.ok) return null;
    const body = (await r.json()) as { results?: { iata: string | null; icao: string | null; ident: string }[]; metro?: { codes: string[] } | null };
    const metro = body.metro?.codes?.[0];
    if (metro) return metro;
    const a = body.results?.[0];
    return a ? (a.iata ?? a.icao ?? a.ident) : null;
  } catch {
    return null;
  }
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
      hint: 'Main airport of each city; switch airports in PATHS',
      keywords: [q, 'route', 'plan', 'flight path'],
      run: () => {
        ui().setOpenPanel('paths');
        void Promise.all([resolveAirport(route.from, fetchImpl), resolveAirport(route.to, fetchImpl)]).then(([from, to]) => {
          if (from && to && from !== to) {
            setPathsDraft(null);
            ui().setFlightIdent(null);
            ui().setPlannedRoute({ from, to });
          } else {
            // Tell the planner which names did not resolve instead of failing silently.
            setPathsDraft({ from: from ?? route.from, to: to ?? route.to, unresolved: [!from && route.from, !to && route.to].filter((n): n is string => !!n) });
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
