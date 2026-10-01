/**
 * The single source of truth for map layers: the rail, the map host, the URL state, the
 * attribution panel, /docs and the Intel Feed all read this. Ids, labels and group order
 * follow OSIRIS's LAYER_GROUPS exactly (docs/reference/27 §1), with GODSEYE additions marked.
 *
 * Pure data (serialisable, importable on server and client). Rendering code lives in the
 * owning feature module (src/features/<domain>), which registers itself by layer id.
 * Owner: lead. Builders request changes in their report.
 */
import type { CapabilityId } from './capabilities';
import type { EntityKind } from './types';

export const LAYER_GROUPS = [
  { id: 'sdk', rail: 'SDK', label: 'GODSEYE SDK', icon: 'Network' },
  { id: 'aviation', rail: 'AVIATION', label: 'AVIATION', icon: 'Plane' },
  { id: 'maritime', rail: 'MARITIME', label: 'MARITIME', icon: 'Ship' },
  { id: 'space', rail: 'SPACE', label: 'SPACE TRACKING', icon: 'Satellite' },
  { id: 'surveillance', rail: 'SURVEIL', label: 'SURVEILLANCE', icon: 'Camera' },
  { id: 'hazards', rail: 'HAZARD', label: 'NATURAL HAZARDS', icon: 'CloudLightning' },
  { id: 'threats', rail: 'THREAT', label: 'THREATS & INTEL', icon: 'TriangleAlert' },
  { id: 'network', rail: 'NETWORK', label: 'NETWORK INTEL', icon: 'Bug' },
  { id: 'netintel', rail: 'NETINTEL', label: 'NET & EVENT INTEL', icon: 'Megaphone' },
  { id: 'display', rail: 'DISPLAY', label: 'DISPLAY', icon: 'Sun' },
] as const;

export type LayerGroupId = (typeof LAYER_GROUPS)[number]['id'];

export type BuilderAgent =
  | 'map-engine'
  | 'layers-aviation'
  | 'layers-space'
  | 'layers-hazards'
  | 'layers-surveillance'
  | 'layers-threats-network'
  | 'panels-alerts-markets-dossier-graph'
  | 'feature-flight-paths';

export interface LayerDef {
  id: string;
  group: LayerGroupId;
  label: string;
  description?: string;
  /** lucide-react icon name. */
  icon: string;
  /** CSS custom property holding the layer's primary colour (see src/styles/tokens.css). */
  colorToken: `--${string}`;
  /** API route that feeds the layer (null for purely client-side layers). */
  route: string | null;
  /** How the client receives data. */
  transport: 'poll' | 'sse' | 'static' | 'none';
  /** Client poll interval in ms for `poll` (paused while the tab is hidden). */
  refreshMs: number | null;
  /** Which engine draws it. `deck` = deck.gl interleaved overlay, `maplibre` = native style layers. */
  renderer: 'deck' | 'maplibre' | 'dom' | 'mixed';
  /** Entity kind whose card opens on click (null = no card). */
  card: EntityKind | null;
  /** Whether the layer emits Intel Feed events. */
  feedEvents: boolean;
  /** Server capability required to show the toggle (null = keyless). */
  capability: CapabilityId | null;
  defaultOn: boolean;
  /** Sub-layer of another toggle (indented, dimmed while the parent is off). */
  parent?: string;
  /** For satellite sub-layers: the category counted in the badge. */
  countKey?: string;
  /** live = observed data; reference = curated/static (badged REFERENCE, never LIVE). */
  kind: 'live' | 'reference' | 'mixed';
  minZoom?: number;
  /** Draw order within the deck/maplibre stack (higher draws on top). */
  z: number;
  /**
   * Click arbitration when several entities are under the cursor (higher wins), independent of
   * draw order: aircraft and cameras beat satellites drawn above them (OSIRIS CLICKABLE_LAYERS,
   * docs/reference/11 §23), points beat polygons.
   */
  pickPriority: number;
  owner: BuilderAgent;
  /** GODSEYE addition not present in OSIRIS's rail. */
  added?: boolean;
}

const MIN = 60_000;

export const LAYERS = [
  // ── GODSEYE SDK ────────────────────────────────────────────────────────────────
  {
    id: 'sdk_sea', group: 'sdk', label: 'Maritime Lines', description: 'Submarine cables + landing points (TeleGeography)',
    icon: 'Cable', colorToken: '--map-cable', route: '/api/cables', transport: 'static', refreshMs: null,
    renderer: 'maplibre', card: 'cable', feedEvents: false, capability: 'nc_sources', defaultOn: true, kind: 'reference', z: 10, pickPriority: 15,
    owner: 'layers-threats-network',
  },
  // ── AVIATION ───────────────────────────────────────────────────────────────────
  {
    id: 'flights', group: 'aviation', label: 'Commercial', icon: 'Plane', colorToken: '--map-flight-civil',
    route: '/api/flights', transport: 'poll', refreshMs: 15_000, renderer: 'deck', card: 'aircraft', feedEvents: true,
    capability: null, defaultOn: false, kind: 'live', z: 80, pickPriority: 100, owner: 'layers-aviation',
  },
  {
    id: 'private', group: 'aviation', label: 'Private', icon: 'Plane', colorToken: '--map-flight-private',
    route: '/api/flights', transport: 'poll', refreshMs: 15_000, renderer: 'deck', card: 'aircraft', feedEvents: true,
    capability: null, defaultOn: false, kind: 'live', z: 81, pickPriority: 100, owner: 'layers-aviation',
  },
  {
    id: 'jets', group: 'aviation', label: 'Private Jets', icon: 'Plane', colorToken: '--map-flight-gov',
    route: '/api/flights', transport: 'poll', refreshMs: 15_000, renderer: 'deck', card: 'aircraft', feedEvents: true,
    capability: null, defaultOn: false, kind: 'live', z: 82, pickPriority: 100, owner: 'layers-aviation',
  },
  {
    id: 'military', group: 'aviation', label: 'Military', icon: 'Plane', colorToken: '--map-flight-military',
    route: '/api/flights', transport: 'poll', refreshMs: 15_000, renderer: 'deck', card: 'aircraft', feedEvents: true,
    capability: null, defaultOn: false, kind: 'live', z: 83, pickPriority: 100, owner: 'layers-aviation',
  },
  {
    id: 'gps_jam', group: 'aviation', label: 'GPS Interference', description: 'gpsjam daily H3 + live NACp binning',
    icon: 'Radar', colorToken: '--map-gps-jam', route: '/api/gps-interference', transport: 'poll', refreshMs: 15 * MIN,
    renderer: 'deck', card: 'gps_jam_cell', feedEvents: false, capability: null, defaultOn: false, kind: 'live', z: 20, pickPriority: 12,
    owner: 'layers-hazards', added: true,
  },
  // ── MARITIME ───────────────────────────────────────────────────────────────────
  {
    id: 'maritime', group: 'maritime', label: 'Maritime / Naval', description: 'Ports, chokepoints and AIS vessels (when keyed)',
    icon: 'Anchor', colorToken: '--map-port', route: '/api/maritime', transport: 'poll', refreshMs: 10_000,
    renderer: 'mixed', card: 'vessel', feedEvents: true, capability: null, defaultOn: true, kind: 'mixed', z: 60, pickPriority: 90,
    owner: 'layers-threats-network',
  },
  // ── SPACE TRACKING ─────────────────────────────────────────────────────────────
  {
    id: 'satellites', group: 'space', label: 'All Satellites', icon: 'Satellite', colorToken: '--map-sat-other',
    route: '/api/satellites', transport: 'poll', refreshMs: 120 * MIN, renderer: 'deck', card: 'satellite', feedEvents: false,
    capability: null, defaultOn: true, kind: 'live', z: 90, pickPriority: 40, owner: 'layers-space',
  },
  ...(
    [
      ['sat_comms', 'Starlink / Comms', 'comms', '--map-sat-comms'],
      ['sat_military', 'Military / Intel', 'military', '--map-sat-military'],
      ['sat_navigation', 'GPS / Navigation', 'navigation', '--map-sat-navigation'],
      ['sat_earth', 'Earth Observation', 'earth_obs', '--map-sat-earth'],
      ['sat_science', 'Stations / Telescopes', 'science', '--map-sat-science'],
    ] as const
  ).map(
    ([id, label, countKey, colorToken], i) =>
      ({
        id, group: 'space', label, icon: 'Satellite', colorToken, route: '/api/satellites', transport: 'poll',
        refreshMs: 120 * MIN, renderer: 'deck', card: 'satellite', feedEvents: false, capability: null, defaultOn: false,
        countKey, kind: 'live', z: 91 + i, pickPriority: 40, owner: 'layers-space',
      }) as const,
  ),
  // ── SURVEILLANCE ───────────────────────────────────────────────────────────────
  {
    id: 'cctv', group: 'surveillance', label: 'CCTV Cameras', description: 'Official public traffic/city cameras',
    icon: 'Camera', colorToken: '--map-cctv', route: '/api/cctv', transport: 'poll', refreshMs: 30 * MIN,
    renderer: 'deck', card: 'camera', feedEvents: false, capability: null, defaultOn: true, kind: 'live', z: 50, pickPriority: 95,
    owner: 'layers-surveillance',
  },
  {
    id: 'cctv_previews', group: 'surveillance', label: 'Live Previews', description: 'Frame tiles at zoom 13+',
    icon: 'Video', colorToken: '--map-cctv', route: null, transport: 'none', refreshMs: null, renderer: 'dom', card: 'camera',
    feedEvents: false, capability: null, defaultOn: true, parent: 'cctv', kind: 'live', minZoom: 13, z: 51, pickPriority: 95,
    owner: 'layers-surveillance',
  },
  {
    id: 'live_news', group: 'surveillance', label: 'Live News Feeds', icon: 'Tv', colorToken: '--map-news',
    route: '/api/live-news', transport: 'poll', refreshMs: 60 * MIN, renderer: 'maplibre', card: 'news_channel',
    feedEvents: false, capability: null, defaultOn: true, kind: 'live', z: 52, pickPriority: 85, owner: 'layers-surveillance',
  },
  // ── NATURAL HAZARDS ────────────────────────────────────────────────────────────
  {
    id: 'earthquakes', group: 'hazards', label: 'Earthquakes', icon: 'Activity', colorToken: '--map-seismic',
    route: '/api/earthquakes', transport: 'poll', refreshMs: 60_000, renderer: 'deck', card: 'earthquake', feedEvents: true,
    capability: null, defaultOn: true, kind: 'live', z: 40, pickPriority: 70, owner: 'layers-hazards',
  },
  {
    id: 'fires', group: 'hazards', label: 'Active Fires', icon: 'Flame', colorToken: '--map-fire', route: '/api/fires',
    transport: 'poll', refreshMs: 15 * MIN, renderer: 'deck', card: 'fire', feedEvents: true, capability: null,
    defaultOn: false, kind: 'live', z: 30, pickPriority: 60, owner: 'layers-hazards',
  },
  {
    id: 'weather', group: 'hazards', label: 'Severe Weather', icon: 'CloudRain', colorToken: '--map-weather',
    route: '/api/weather', transport: 'poll', refreshMs: 5 * MIN, renderer: 'mixed', card: 'weather_event', feedEvents: true,
    capability: null, defaultOn: false, kind: 'live', z: 35, pickPriority: 55, owner: 'layers-hazards',
  },
  {
    id: 'air_quality', group: 'hazards', label: 'Air Quality', description: 'PM2.5 / US AQI', icon: 'Wind',
    colorToken: '--map-air-quality', route: '/api/air-quality', transport: 'poll', refreshMs: 15 * MIN, renderer: 'deck',
    card: 'air_quality', feedEvents: false, capability: null, defaultOn: false, kind: 'live', z: 25, pickPriority: 30, owner: 'layers-hazards',
    added: true,
  },
  {
    id: 'weather_radar', group: 'hazards', label: 'Weather Radar', description: 'RainViewer past radar · zoom ≤ 7',
    icon: 'Radar', colorToken: '--map-weather', route: '/api/weather-radar', transport: 'poll', refreshMs: 5 * MIN,
    renderer: 'maplibre', card: null, feedEvents: false, capability: null, defaultOn: false, kind: 'live', z: 15, pickPriority: 0,
    owner: 'layers-hazards', added: true,
  },
  // ── THREATS & INTEL ────────────────────────────────────────────────────────────
  {
    id: 'infrastructure', group: 'threats', label: 'Nuclear Facilities', icon: 'Atom', colorToken: '--map-nuclear',
    route: '/api/infrastructure', transport: 'poll', refreshMs: 24 * 60 * MIN, renderer: 'deck', card: 'nuclear_site',
    feedEvents: false, capability: null, defaultOn: false, kind: 'reference', z: 45, pickPriority: 65, owner: 'layers-threats-network',
  },
  {
    id: 'global_incidents', group: 'threats', label: 'Global Incidents', description: 'GDACS disaster alerts',
    icon: 'Siren', colorToken: '--map-incident', route: '/api/gdacs', transport: 'poll', refreshMs: 10 * MIN,
    renderer: 'deck', card: 'gdacs_incident', feedEvents: true, capability: null, defaultOn: true, kind: 'live', z: 46, pickPriority: 62,
    owner: 'layers-threats-network',
  },
  {
    id: 'alert_pins', group: 'threats', label: 'Live Alert Pins', description: 'Geoparsed Live Alerts',
    icon: 'MapPin', colorToken: '--map-alert-news', route: '/api/news', transport: 'poll', refreshMs: 2 * MIN,
    renderer: 'maplibre', card: 'alert', feedEvents: true, capability: null, defaultOn: false, kind: 'live', z: 70, pickPriority: 88,
    owner: 'panels-alerts-markets-dossier-graph',
  },
  {
    id: 'gdelt_events', group: 'threats', label: 'GDELT Events', description: '15-minute export, CAMEO QuadClass',
    icon: 'Newspaper', colorToken: '--map-gdelt-4', route: '/api/gdelt-events', transport: 'poll', refreshMs: 15 * MIN,
    renderer: 'deck', card: 'gdelt_event', feedEvents: true, capability: null, defaultOn: false, kind: 'live', z: 47, pickPriority: 58,
    owner: 'layers-threats-network',
  },
  {
    id: 'conflict_zones', group: 'threats', label: 'Conflict Zones', description: 'Curated reference polygons',
    icon: 'Crosshair', colorToken: '--map-conflict', route: '/api/conflicts', transport: 'poll', refreshMs: 15 * MIN,
    renderer: 'maplibre', card: 'conflict_zone', feedEvents: false, capability: null, defaultOn: false, kind: 'reference', z: 5, pickPriority: 8,
    owner: 'layers-threats-network', added: true,
  },
  {
    id: 'frontlines', group: 'threats', label: 'Frontlines', description: 'DeepStateMap (non-commercial)',
    icon: 'Waypoints', colorToken: '--map-conflict', route: '/api/frontlines', transport: 'poll', refreshMs: 60 * MIN,
    renderer: 'maplibre', card: 'frontline', feedEvents: false, capability: 'deepstate', defaultOn: false, kind: 'live', z: 6, pickPriority: 10,
    owner: 'layers-threats-network', added: true,
  },
  {
    id: 'country_risk', group: 'threats', label: 'Country Risk', description: 'INFORM risk per country; small states as points; WGI-only rows not shaded',
    icon: 'Earth', colorToken: '--map-risk', route: '/api/country-risk', transport: 'poll', refreshMs: 24 * 60 * MIN,
    renderer: 'maplibre', card: 'country_risk', feedEvents: false, capability: null, defaultOn: false, kind: 'reference', z: 2, pickPriority: 5,
    owner: 'layers-threats-network', added: true,
  },
  // ── NETWORK INTEL ──────────────────────────────────────────────────────────────
  {
    id: 'malware', group: 'network', label: 'Live Malware', description: 'URLhaus hosts over SSE',
    icon: 'Bug', colorToken: '--map-malware', route: '/api/malware/stream', transport: 'sse', refreshMs: null,
    renderer: 'deck', card: 'malware_host', feedEvents: true, capability: 'nc_sources', defaultOn: false, kind: 'live', z: 55, pickPriority: 75,
    owner: 'layers-threats-network',
  },
  {
    id: 'cyber_attacks', group: 'network', label: 'Botnet C2 Servers', description: 'Feodo Tracker indicators',
    icon: 'ShieldAlert', colorToken: '--map-c2-online', route: '/api/cyber-attacks', transport: 'poll', refreshMs: 5 * MIN,
    renderer: 'deck', card: 'c2_server', feedEvents: true, capability: 'nc_sources', defaultOn: false, kind: 'live', z: 56, pickPriority: 76,
    owner: 'layers-threats-network',
  },
  {
    id: 'threatfox', group: 'network', label: 'ThreatFox IOCs', description: 'abuse.ch indicators (geolocated IPs)',
    icon: 'Biohazard', colorToken: '--map-malware', route: '/api/threatfox', transport: 'poll', refreshMs: 10 * MIN,
    renderer: 'deck', card: 'threat_indicator', feedEvents: true, capability: 'nc_sources', defaultOn: false, kind: 'live', z: 57, pickPriority: 74,
    owner: 'layers-threats-network', added: true,
  },
  // ── NET & EVENT INTEL ──────────────────────────────────────────────────────────
  {
    id: 'cf_outages', group: 'netintel', label: 'Internet Outages', description: 'IODA (keyless) + Cloudflare Radar (keyed)',
    icon: 'Signal', colorToken: '--map-outage', route: '/api/outages', transport: 'poll', refreshMs: 5 * MIN,
    renderer: 'deck', card: 'outage', feedEvents: true, capability: null, defaultOn: false, kind: 'live', z: 48, pickPriority: 50,
    owner: 'layers-threats-network',
  },
  {
    id: 'cf_attacks', group: 'netintel', label: 'Attack Origins', description: 'Cloudflare Radar L3 origins',
    icon: 'Zap', colorToken: '--map-attack', route: '/api/cloudflare-radar', transport: 'poll', refreshMs: 5 * MIN,
    renderer: 'deck', card: 'attack_origin', feedEvents: false, capability: 'cloudflare', defaultOn: false, kind: 'live', z: 49, pickPriority: 48,
    owner: 'layers-threats-network',
  },
  // ── DISPLAY ────────────────────────────────────────────────────────────────────
  {
    id: 'day_night', group: 'display', label: 'Day / Night Cycle', description: 'Computed twilight bands + Black Marble 2016 night lights',
    icon: 'Moon', colorToken: '--map-night', route: null, transport: 'none', refreshMs: 60_000, renderer: 'maplibre',
    card: null, feedEvents: false, capability: null, defaultOn: true, kind: 'reference', z: 1, pickPriority: 0, owner: 'map-engine',
  },
  {
    id: 'terrain_3d', group: 'display', label: '3D Buildings', description: 'City detail · zoom 14.5+', icon: 'Building2',
    colorToken: '--gold-primary', route: null, transport: 'none', refreshMs: null, renderer: 'maplibre', card: null,
    feedEvents: false, capability: null, defaultOn: false, kind: 'reference', minZoom: 14.5, z: 3, pickPriority: 0, owner: 'map-engine',
  },
  {
    id: 'terrain_elevation', group: 'display', label: '3D Terrain', description: 'Mountains · zoom 10+', icon: 'Mountain',
    colorToken: '--gold-primary', route: null, transport: 'none', refreshMs: null, renderer: 'maplibre', card: null,
    feedEvents: false, capability: null, defaultOn: false, kind: 'reference', minZoom: 10, z: 0, pickPriority: 0, owner: 'map-engine',
  },
  {
    id: 'gibs_truecolor', group: 'display', label: 'VIIRS True Colour', description: 'NASA GIBS daily mosaic (previous UTC day, dated)',
    icon: 'Earth', colorToken: '--gold-primary', route: null, transport: 'none', refreshMs: null, renderer: 'maplibre',
    card: null, feedEvents: false, capability: null, defaultOn: false, kind: 'reference', z: 0, pickPriority: 0, owner: 'map-engine', added: true,
  },
  {
    id: 'sentinel', group: 'display', label: 'Sentinel Scenes', description: 'Recent Sentinel-2 footprints in view (CDSE STAC)',
    icon: 'Scan', colorToken: '--cyan-primary', route: '/api/sentinel', transport: 'poll', refreshMs: 5 * MIN,
    renderer: 'maplibre', card: 'sentinel_scene', feedEvents: false, capability: null, defaultOn: false, kind: 'live', z: 4, pickPriority: 20,
    owner: 'layers-hazards', added: true,
  },
] as const satisfies readonly LayerDef[];

export type LayerId = (typeof LAYERS)[number]['id'];

export const LAYER_IDS = LAYERS.map((l) => l.id) as readonly LayerId[];

const byId = new Map<string, LayerDef>(LAYERS.map((l) => [l.id, l]));

export function getLayer(id: string): LayerDef | undefined {
  return byId.get(id);
}

export function isLayerId(id: string): id is LayerId {
  return byId.has(id);
}

export function layersInGroup(group: LayerGroupId): LayerDef[] {
  return LAYERS.filter((l) => l.group === group);
}

export const DEFAULT_ACTIVE_LAYERS: readonly LayerId[] = LAYERS.filter((l) => l.defaultOn).map((l) => l.id);

/**
 * Parse `?layers=a,b,c`, dropping unknown ids and duplicates, preserving registry order. An explicit
 * empty value means "all off"; a value with no known id at all (typo, retired OSIRIS id) is ignored
 * (null) rather than blanking the map.
 */
export function parseLayersParam(value: string | null | undefined): LayerId[] | null {
  if (value == null) return null;
  const parts = value.split(',').map((s) => s.trim()).filter(Boolean);
  const wanted = new Set(parts);
  const out = LAYER_IDS.filter((id) => wanted.has(id));
  return out.length || parts.length === 0 ? out : null;
}

export function serializeLayersParam(active: Iterable<string>): string {
  const set = new Set(active);
  return LAYER_IDS.filter((id) => set.has(id)).join(',');
}

/** Choose the entity to open when several layers report a hit under the cursor. */
export function choosePick<T extends { layer: string }>(hits: readonly T[]): T | null {
  let best: T | null = null;
  let bestPrio = -Infinity;
  for (const h of hits) {
    const p = getLayer(h.layer)?.pickPriority ?? -1;
    if (p > bestPrio) {
      best = h;
      bestPrio = p;
    }
  }
  return best;
}

/** Layers the visitor can actually toggle given server capabilities (from /api/health). */
export function visibleLayers(capabilities: Partial<Record<CapabilityId, { enabled: boolean }>>): LayerDef[] {
  return LAYERS.filter((l) => l.capability === null || capabilities[l.capability]?.enabled === true);
}

/**
 * Default-on layers the deployment can serve. The shell applies this once /api/health has loaded
 * (before the first URL write), so a licence-gated default (e.g. sdk_sea without nc_sources) never
 * lands in a share link or calls a gated route.
 */
export function defaultLayersFor(capabilities: Partial<Record<CapabilityId, { enabled: boolean }>>): LayerId[] {
  const ok = new Set(visibleLayers(capabilities).map((l) => l.id));
  return DEFAULT_ACTIVE_LAYERS.filter((id) => ok.has(id));
}

/**
 * How often a sensor re-observes an entity of this layer (ms), for entity-card freshness via
 * `entityFreshness()` in src/lib/freshness.ts. `null` = event or reference layer: an event is not
 * re-observed, so its card inherits the feed state and shows the event's age as text. This is NOT
 * the client poll interval (`refreshMs`): a real two-hour-old quake from a feed polled a minute ago
 * is not STALE.
 */
export const OBSERVATION_CADENCE_MS = {
  sdk_sea: 60_000,
  flights: 60_000,
  private: 60_000,
  jets: 60_000,
  military: 60_000,
  gps_jam: null,
  maritime: 10 * 60_000,
  satellites: null,
  sat_comms: null,
  sat_military: null,
  sat_navigation: null,
  sat_earth: null,
  sat_science: null,
  cctv: null,
  cctv_previews: null,
  live_news: null,
  earthquakes: null,
  fires: null,
  weather: null,
  air_quality: null,
  weather_radar: null,
  infrastructure: null,
  global_incidents: null,
  alert_pins: null,
  gdelt_events: null,
  conflict_zones: null,
  frontlines: null,
  country_risk: null,
  malware: null,
  cyber_attacks: null,
  threatfox: null,
  cf_outages: null,
  cf_attacks: null,
  day_night: null,
  terrain_3d: null,
  terrain_elevation: null,
  gibs_truecolor: null,
  sentinel: null,
} as const satisfies Record<LayerId, number | null>;
