/**
 * Shareable, restorable URL state: camera + layers + theme + open panel + route + flight.
 *   ?c=lat,lng,zoom[,pitch,bearing]   ?layers=a,b,c   ?theme=HORUS   ?panel=paths
 *   ?route=LHR-JFK                    ?flight=BA117   ?proj=mercator
 * Pure parse/serialise helpers (unit-tested); the client hook that syncs them with nuqs lives in
 * src/components/UrlStateSync.tsx. Owner: lead.
 */
import { LAYER_IDS, parseLayersParam, serializeLayersParam, type LayerId } from './layer-registry';
import { TOOLS, PANELS, type PanelId } from './tool-registry';

export interface CameraParam {
  lat: number;
  lng: number;
  zoom: number;
  pitch: number;
  bearing: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number, dp: number) => Number(v.toFixed(dp));

export function parseCamera(value: string | null | undefined): CameraParam | null {
  if (!value) return null;
  const parts = value.split(',').map((s) => Number(s.trim()));
  if (parts.length < 3 || parts.length > 5 || parts.some((n) => !Number.isFinite(n))) return null;
  const [lat, lng, zoom, pitch = 0, bearing = 0] = parts as [number, number, number, number?, number?];
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng, zoom: clamp(zoom, 0, 22), pitch: clamp(pitch ?? 0, 0, 85), bearing: ((((bearing ?? 0) + 180) % 360) + 360) % 360 - 180 };
}

export function serializeCamera(c: CameraParam): string {
  const parts = [round(c.lat, 4), round(c.lng, 4), round(c.zoom, 2)];
  if (Math.abs(c.pitch) > 0.5 || Math.abs(c.bearing) > 0.5) parts.push(round(c.pitch, 1), round(c.bearing, 1));
  return parts.join(',');
}

/** `LHR-JFK`, `EGLL-KJFK` (also accepts `→`, `>`, spaces). Codes are 3–4 alphanumerics. */
export function parseRouteParam(value: string | null | undefined): { from: string; to: string } | null {
  if (!value) return null;
  const m = value.trim().toUpperCase().match(/^([A-Z0-9]{3,4})\s*(?:-|→|>|\s)\s*([A-Z0-9]{3,4})$/);
  if (!m || m[1] === m[2]) return null;
  return { from: m[1]!, to: m[2]! };
}

export function serializeRouteParam(r: { from: string; to: string }): string {
  return `${r.from.toUpperCase()}-${r.to.toUpperCase()}`;
}

/** Flight idents: ICAO callsign, IATA flight number, registration or 6-hex. */
export function parseFlightParam(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim().toUpperCase();
  return /^[A-Z0-9-]{2,10}$/.test(v) ? v : null;
}

const PANEL_IDS = new Set<string>([...TOOLS.map((t) => t.id), ...PANELS.map((p) => p.id)]);

export function parsePanelParam(value: string | null | undefined): PanelId | null {
  return value && PANEL_IDS.has(value) ? (value as PanelId) : null;
}

export interface UrlState {
  camera: CameraParam | null;
  layers: LayerId[] | null;
  theme: string | null;
  panel: PanelId | null;
  route: { from: string; to: string } | null;
  flight: string | null;
  projection: 'globe' | 'mercator' | null;
}

export function parseUrlState(params: URLSearchParams): UrlState {
  const proj = params.get('proj');
  const theme = params.get('theme');
  return {
    camera: parseCamera(params.get('c')),
    layers: parseLayersParam(params.get('layers')),
    theme: theme && /^[A-Z0-9_-]{2,24}$/i.test(theme) ? theme.toUpperCase() : null,
    panel: parsePanelParam(params.get('panel')),
    route: parseRouteParam(params.get('route')),
    flight: parseFlightParam(params.get('flight')),
    projection: proj === 'globe' || proj === 'mercator' ? proj : null,
  };
}

export function buildShareUrl(origin: string, s: Partial<UrlState> & { layers?: Iterable<string> | null }): string {
  const url = new URL('/', origin);
  if (s.camera) url.searchParams.set('c', serializeCamera(s.camera));
  if (s.layers) url.searchParams.set('layers', serializeLayersParam(s.layers));
  if (s.theme) url.searchParams.set('theme', s.theme);
  if (s.panel) url.searchParams.set('panel', s.panel);
  if (s.route) url.searchParams.set('route', serializeRouteParam(s.route));
  if (s.flight) url.searchParams.set('flight', s.flight);
  if (s.projection && s.projection !== 'globe') url.searchParams.set('proj', s.projection);
  return url.toString();
}

export { LAYER_IDS };
