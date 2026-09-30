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
  { id: 'paths', label: 'PATHS', tooltip: 'Flight Paths — planned routes between airports', icon: 'Route', accentToken: '--gold-primary', mobileTab: true, owner: 'feature-flight-paths' },
  { id: 'search', label: 'SEARCH', tooltip: 'Search — find locations, cities, coordinates', icon: 'Search', accentToken: '--gold-primary', mobileTab: true, owner: 'panels-recon' },
  { id: 'arcgis', label: 'ARCGIS', tooltip: 'ArcGIS — search & import geospatial intel layers', icon: 'Database', accentToken: '--gold-primary', separatorBefore: true, owner: 'panels-recon' },
  { id: 'remote', label: 'REMOTE', tooltip: 'World Remote — control nearby Bluetooth devices', icon: 'Bluetooth', accentToken: '--cyan-primary', separatorBefore: true, featureDetect: 'bluetooth', owner: 'panels-recon' },
] as const satisfies readonly ToolDef[];

export type ToolId = (typeof TOOLS)[number]['id'];

/** Panels opened from elsewhere (keys, cards, rail bottom, double right-click). */
export const PANELS = [
  { id: 'layers', label: 'LAYERS', owner: 'design-system-hud' },
  { id: 'intel', label: 'INTEL FEED', owner: 'panels-alerts-markets-dossier-graph' },
  { id: 'dossier', label: 'REGION DOSSIER', owner: 'panels-alerts-markets-dossier-graph' },
  { id: 'graph', label: 'ENTITY GRAPH', owner: 'panels-alerts-markets-dossier-graph' },
  { id: 'flight-watch', label: 'FLIGHT WATCH', owner: 'layers-aviation' },
  { id: 'camera', label: 'CAMERA VIEWER', owner: 'layers-surveillance' },
  { id: 'satellite', label: 'SATELLITE', owner: 'layers-space' },
  { id: 'settings', label: 'SETTINGS', owner: 'design-system-hud' },
  { id: 'style-studio', label: 'STYLE STUDIO', owner: 'design-system-hud' },
  { id: 'share', label: 'SHARE', owner: 'design-system-hud' },
  { id: 'help', label: 'SHORTCUTS', owner: 'design-system-hud' },
  { id: 'palette', label: 'COMMAND PALETTE', owner: 'design-system-hud' },
  { id: 'attribution', label: 'SOURCES & LICENCES', owner: 'design-system-hud' },
] as const satisfies readonly { id: string; label: string; owner: PanelOwner }[];

export type PanelId = ToolId | (typeof PANELS)[number]['id'];

/** Mobile bottom nav (7 tabs, §7). */
export const MOBILE_TABS = ['layers', 'markets', 'intel', 'recon', 'search', 'paths', 'route'] as const satisfies readonly PanelId[];
