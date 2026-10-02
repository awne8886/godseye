/**
 * Right-rail tools and other panels. Labels/tooltips are OSIRIS's (docs/reference/02) plus
 * GODSEYE's PATHS tool. Panel components are resolved by id in src/components/panels/index.ts.
 * Owner: lead.
 */

export type PanelOwner =
  | 'design-system-hud'
  | 'layers-aviation'
  | 'layers-space'
  | 'layers-surveillance'
  | 'panels-alerts-markets-dossier-graph'
  | 'panels-recon'
  | 'feature-flight-paths';

export interface ToolDef {
  id: string;
  label: string;
  tooltip: string;
  /** lucide-react icon name. */
  icon: string;
  /** CSS custom property for the active accent. */
  accentToken: `--${string}`;
  /** Separator drawn before this button in the strip. */
  separatorBefore?: boolean;
  /** Only shown when the browser supports a feature (World Remote needs Web Bluetooth). */
  featureDetect?: 'bluetooth';
  /** Bottom-nav tab on mobile. */
  mobileTab?: boolean;
  owner: PanelOwner;
}

/** Right tool strip, top to bottom. */
export const TOOLS = [
  { id: 'recon', label: 'RECON', tooltip: 'OSINT Recon — IP lookup, network sweep, geolocation', icon: 'Radar', accentToken: '--cyan-primary', mobileTab: true, owner: 'panels-recon' },
  { id: 'space', label: 'SPACE', tooltip: 'Live from Space — 24/7 video downlink from the ISS', icon: 'Orbit', accentToken: '--cyan-primary', owner: 'layers-space' },
  { id: 'markets', label: 'MARKETS', tooltip: 'Markets — crypto prices, space weather, global indices', icon: 'ChartBar', accentToken: '--gold-primary', mobileTab: true, owner: 'panels-alerts-markets-dossier-graph' },
  { id: 'alerts', label: 'ALERTS', tooltip: 'Live Alerts — earthquakes, conflicts, breaking news', icon: 'Radio', accentToken: '--alert-red', owner: 'panels-alerts-markets-dossier-graph' },
  { id: 'draw', label: 'DRAW', tooltip: 'Draw — measure areas of interest on the map', icon: 'PenLine', accentToken: '--cyan-primary', owner: 'panels-recon' },
  { id: 'route', label: 'ROUTE', tooltip: 'Directions — turn-by-turn routing', icon: 'Navigation', accentToken: '--gold-primary', mobileTab: true, owner: 'panels-recon' },
  { id: 'paths', label: 'FLIGHT PATHS', tooltip: 'Flight Paths — planned routes between airports', icon: 'Route', accentToken: '--gold-primary', mobileTab: true, owner: 'feature-flight-paths' },
  { id: 'search', label: 'SEARCH', tooltip: 'Search — find locations, cities, coordinates', icon: 'Search', accentToken: '--gold-primary', mobileTab: true, owner: 'panels-recon' },
  { id: 'arcgis', label: 'ARCGIS', tooltip: 'ArcGIS — search & import geospatial intel layers', icon: 'Database', accentToken: '--gold-primary', separatorBefore: true, owner: 'panels-recon' },
  { id: 'remote', label: 'REMOTE', tooltip: 'World Remote — control nearby Bluetooth devices', icon: 'Bluetooth', accentToken: '--cyan-primary', separatorBefore: true, featureDetect: 'bluetooth', owner: 'panels-recon' },
] as const satisfies readonly ToolDef[];

export type ToolId = (typeof TOOLS)[number]['id'];

/**
 * Where a panel is launched from (besides keys and the command palette):
 * rail-bottom = under the layer rail; status-bar = footer link; card = from an entity card;
 * map = a map gesture (double right-click / long-press); key = keyboard/palette only.
 */
export type Launcher = 'rail-bottom' | 'status-bar' | 'card' | 'map' | 'key';

/** Panels opened from elsewhere (keys, cards, rail bottom, status bar, map gestures). */
export const PANELS = [
  { id: 'layers', label: 'LAYERS', launcher: 'key', owner: 'design-system-hud' },
  { id: 'presets', label: 'REGION PRESETS', launcher: 'key', owner: 'design-system-hud' },
  { id: 'intel', label: 'INTEL FEED', launcher: 'key', owner: 'panels-alerts-markets-dossier-graph' },
  { id: 'dossier', label: 'REGION DOSSIER', launcher: 'map', owner: 'panels-alerts-markets-dossier-graph' },
  { id: 'graph', label: 'ENTITY GRAPH', launcher: 'card', owner: 'panels-alerts-markets-dossier-graph' },
  { id: 'flight-watch', label: 'FLIGHT WATCH', launcher: 'card', owner: 'layers-aviation' },
  { id: 'camera', label: 'CAMERA VIEWER', launcher: 'card', owner: 'layers-surveillance' },
  { id: 'live-news', label: 'LIVE NEWS', launcher: 'card', owner: 'layers-surveillance' },
  { id: 'satellite', label: 'SATELLITE', launcher: 'card', owner: 'layers-space' },
  { id: 'settings', label: 'SETTINGS', launcher: 'rail-bottom', owner: 'design-system-hud' },
  { id: 'style-studio', label: 'STYLE STUDIO', launcher: 'rail-bottom', owner: 'design-system-hud' },
  { id: 'share', label: 'SHARE', launcher: 'status-bar', owner: 'design-system-hud' },
  { id: 'help', label: 'SHORTCUTS', launcher: 'status-bar', owner: 'design-system-hud' },
  { id: 'palette', label: 'COMMAND PALETTE', launcher: 'key', owner: 'design-system-hud' },
  { id: 'attribution', label: 'SOURCES & LICENCES', launcher: 'status-bar', owner: 'design-system-hud' },
] as const satisfies readonly { id: string; label: string; launcher: Launcher; owner: PanelOwner }[];

export type PanelId = ToolId | (typeof PANELS)[number]['id'];

/** Mobile bottom nav (7 tabs, §7). */
export const MOBILE_TABS = ['layers', 'markets', 'intel', 'recon', 'search', 'paths', 'route'] as const satisfies readonly PanelId[];

/**
 * What each mobile tab's bottom sheet contains, so every tool stays reachable on phones
 * (ALERTS, SPACE, DRAW, ARCGIS, REMOTE and the rail-bottom panels have no tab of their own).
 */
export const MOBILE_SHEETS = {
  layers: ['layers', 'presets', 'style-studio', 'settings'],
  markets: ['markets', 'space'],
  intel: ['intel', 'alerts'],
  recon: ['recon', 'arcgis', 'remote'],
  search: ['search', 'share', 'attribution'],
  paths: ['paths'],
  route: ['route', 'draw'],
} as const satisfies Record<(typeof MOBILE_TABS)[number], readonly PanelId[]>;
