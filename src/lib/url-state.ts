/**
 * Shareable, restorable URL state: camera + layers + theme + open/pinned panels + route + flight
 * + dossier target.
 *   ?c=lat,lng,zoom[,pitch,bearing]   ?layers=a,b,c   ?theme=HORUS   ?panel=paths   ?pinned=a,b
 *   ?route=LHR-JFK   ?flight=BA117   ?dossier=lat,lng   ?proj=mercator
 * OSIRIS links (`?lat=&lon=&zoom=`) are accepted on read and never written.
 * Pure parse/serialise helpers (unit-tested); the client hook that syncs them with nuqs lives in
 * src/components/UrlStateSync.tsx. Owner: lead.
 */
import { normalizeLng } from './geo';
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

/** Split a comma list of numbers; empty components are invalid (Number('') would be 0). */
function numbers(value: string): number[] | null {
  const raw = value.split(',').map((s) => s.trim());
  if (raw.some((s) => s === '')) return null;
  const nums = raw.map(Number);
  return nums.some((n) => !Number.isFinite(n)) ? null : nums;
}

/**
 * `lat,lng,zoom[,pitch,bearing]`. Longitudes outside ±180 (MapLibre's unwrapped view after panning
 * across the antimeridian in mercator) are wrapped, not rejected.
 */
export function parseCamera(value: string | null | undefined): CameraParam | null {
  if (!value) return null;
  const parts = numbers(value);
  if (!parts || parts.length < 3 || parts.length > 5) return null;
  const [lat, rawLng, zoom, pitch = 0, bearing = 0] = parts as [number, number, number, number?, number?];
  if (Math.abs(lat) > 90 || Math.abs(rawLng) > 1e6) return null;
  const lng = normalizeLng(rawLng);
  return { lat, lng, zoom: clamp(zoom, 0, 22), pitch: clamp(pitch ?? 0, 0, 85), bearing: ((((bearing ?? 0) + 180) % 360) + 360) % 360 - 180 };
}

export function serializeCamera(c: CameraParam): string {
  const parts = [round(c.lat, 4), round(normalizeLng(c.lng), 4), round(c.zoom, 2)];
  if (Math.abs(c.pitch) > 0.5 || Math.abs(c.bearing) > 0.5) parts.push(round(c.pitch, 1), round(c.bearing, 1));
  return parts.join(',');
}

/** OSIRIS-era `?lat=&lon=&zoom=` links (read-only compatibility). */
export function parseLegacyCamera(params: URLSearchParams): CameraParam | null {
  const lat = params.get('lat');
  const lon = params.get('lon') ?? params.get('lng');
  if (lat === null || lon === null) return null;
  return parseCamera(`${lat},${lon},${params.get('zoom') ?? '4'}`);
}

/** `?dossier=lat,lng` */
export function parseLatLngParam(value: string | null | undefined): { lat: number; lng: number } | null {
  if (!value) return null;
  const parts = numbers(value);
  if (!parts || parts.length !== 2) return null;
  const [lat, lng] = parts as [number, number];
  if (Math.abs(lat) > 90 || Math.abs(lng) > 1e6) return null;
  return { lat, lng: normalizeLng(lng) };
}

export function serializeLatLng(p: { lat: number; lng: number }): string {
  return `${round(p.lat, 4)},${round(normalizeLng(p.lng), 4)}`;
}

/**
 * `LHR-JFK`, `EGLL-KJFK`, `EGLL-CYVR1` (also `→`, `>`, spaces). Codes are 3–8 alphanumerics
 * (IATA, ICAO, gps_code, OurAirports ident). Idents that contain a hyphen (`US-0001`) use `~` as
 * the separator: `EGLL~US-0001`.
 */
export function parseRouteParam(value: string | null | undefined): { from: string; to: string } | null {
  if (!value) return null;
  const v = value.trim().toUpperCase();
  const m = v.includes('~')
    ? v.match(/^([A-Z0-9-]{3,10})~([A-Z0-9-]{3,10})$/)
    : v.match(/^([A-Z0-9]{3,8})\s*(?:-|→|>|\s)\s*([A-Z0-9]{3,8})$/);
  if (!m || m[1] === m[2] || /^-|-$/.test(m[1]!) || /^-|-$/.test(m[2]!)) return null;
  return { from: m[1]!, to: m[2]! };
}

export function serializeRouteParam(r: { from: string; to: string }): string {
  const from = r.from.toUpperCase();
  const to = r.to.toUpperCase();
  return from.includes('-') || to.includes('-') ? `${from}~${to}` : `${from}-${to}`;
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

/** `?pinned=flight-watch,camera` — unknown ids dropped, duplicates removed, at most 6. */
export function parsePinnedParam(value: string | null | undefined): PanelId[] | null {
  if (!value) return null;
  const ids = [...new Set(value.split(',').map((s) => s.trim()))].filter((id) => PANEL_IDS.has(id)) as PanelId[];
  return ids.length ? ids.slice(0, 6) : null;
}

export interface UrlState {
  camera: CameraParam | null;
  layers: LayerId[] | null;
  theme: string | null;
  panel: PanelId | null;
  pinned: PanelId[] | null;
  route: { from: string; to: string } | null;
  flight: string | null;
  dossier: { lat: number; lng: number } | null;
  projection: 'globe' | 'mercator' | null;
}

export function parseUrlState(params: URLSearchParams): UrlState {
  const proj = params.get('proj');
  const theme = params.get('theme');
  return {
    camera: parseCamera(params.get('c')) ?? parseLegacyCamera(params),
    layers: parseLayersParam(params.get('layers')),
    theme: theme && /^[A-Z0-9_-]{2,24}$/i.test(theme) ? theme.toUpperCase() : null,
    panel: parsePanelParam(params.get('panel')),
    pinned: parsePinnedParam(params.get('pinned')),
    route: parseRouteParam(params.get('route')),
    flight: parseFlightParam(params.get('flight')),
    dossier: parseLatLngParam(params.get('dossier')),
    projection: proj === 'globe' || proj === 'mercator' ? proj : null,
  };
}

export function buildShareUrl(origin: string, s: Partial<UrlState> & { layers?: Iterable<string> | null }): string {
  const url = new URL('/', origin);
  if (s.camera) url.searchParams.set('c', serializeCamera(s.camera));
  if (s.layers) url.searchParams.set('layers', serializeLayersParam(s.layers));
  if (s.theme) url.searchParams.set('theme', s.theme);
  if (s.panel) url.searchParams.set('panel', s.panel);
  if (s.pinned?.length) url.searchParams.set('pinned', s.pinned.join(','));
  if (s.route) url.searchParams.set('route', serializeRouteParam(s.route));
  if (s.flight) url.searchParams.set('flight', s.flight);
  if (s.dossier) url.searchParams.set('dossier', serializeLatLng(s.dossier));
  if (s.projection && s.projection !== 'globe') url.searchParams.set('proj', s.projection);
  return url.toString();
}

export { LAYER_IDS };
