/**
 * Turn-by-turn routing for /api/directions. Valhalla (FOSSGIS public instance) is primary: it
 * returns narrative instructions, alternates, toll/highway/ferry flags and an elevation profile
 * (/height, walk and bike only). OSRM is the fallback: router.project-osrm.org for driving and
 * the FOSSGIS routed-foot / routed-bike instances for walking and cycling; OSRM ships no
 * instruction text, so maneuvers are phrased from type + modifier + street name.
 * Self-hosted engines: VALHALLA_URL, OSRM_URL. Owner: panels-recon. Server-only.
 */
import 'server-only';
import { HttpError, httpJson } from '@/lib/http';
import { providerBucket } from '@/lib/ratelimit';
import type { DirectionsResponse, Providers } from '@/lib/types';
import { probe } from './lookup';

export type Mode = DirectionsResponse['mode'];
export type Route = DirectionsResponse['routes'][number];
export interface LatLng {
  lat: number;
  lng: number;
}
export interface Avoid {
  tolls: boolean;
  highways: boolean;
  ferries: boolean;
}

/** OSIRIS names are accepted as aliases. */
export const MODE_ALIASES: Record<string, Mode> = { drive: 'drive', auto: 'drive', walk: 'walk', pedestrian: 'walk', bike: 'bike', bicycle: 'bike' };
const VALHALLA_COSTING: Record<Mode, string> = { drive: 'auto', walk: 'pedestrian', bike: 'bicycle' };

export const DIRECTIONS_ATTRIBUTION = 'Routing: Valhalla (FOSSGIS) · OSRM · © OpenStreetMap contributors (ODbL)';

const valhallaBase = () => (process.env.VALHALLA_URL || 'https://valhalla1.openstreetmap.de').replace(/\/$/, '');
const osrmBase = (mode: Mode) => {
  if (process.env.OSRM_URL) return process.env.OSRM_URL.replace(/\/$/, '');
  return mode === 'drive' ? 'https://router.project-osrm.org' : mode === 'walk' ? 'https://routing.openstreetmap.de/routed-foot' : 'https://routing.openstreetmap.de/routed-bike';
};
/** FOSSGIS usage policy: modest, identified use. One request per second per instance. */
const valhallaBucket = () => providerBucket('valhalla', 1, 2);
const osrmBucket = () => providerBucket('osrm', 1, 2);

/** `"51.5,-0.12"` (lat,lng — OSIRIS order) → point, or null. */
export function parsePoint(raw: string | null | undefined): LatLng | null {
  if (!raw) return null;
  const parts = raw.split(',').map((n) => Number(n.trim()));
  if (parts.length !== 2) return null;
  const [lat, lng] = parts as [number, number];
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/** Encoded polyline → [lng, lat][] (Valhalla precision 6, OSRM 5). */
export function decodePolyline(encoded: string, precision = 6): [number, number][] {
  const factor = 10 ** precision;
  const out: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  // Past the end charCodeAt() is NaN, which ends each varint loop (a malformed string cannot spin).
  const next = () => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += next();
    lng += next();
    out.push([lng / factor, lat / factor]);
  }
  return out;
}

// ── Valhalla ────────────────────────────────────────────────────────────────────
interface ValhallaManeuver {
  type?: number;
  instruction?: string;
  length?: number;
  time?: number;
  begin_shape_index?: number;
}
interface ValhallaTrip {
  legs?: { shape?: string; maneuvers?: ValhallaManeuver[] }[];
  summary?: { length?: number; time?: number; has_highway?: boolean; has_toll?: boolean; has_ferry?: boolean };
}
export interface ValhallaBody {
  trip?: ValhallaTrip;
  alternates?: { trip?: ValhallaTrip }[];
}

/** Valhalla maneuver type → coarse icon key. */
export function valhallaManeuver(type: number): string {
  if (type >= 1 && type <= 3) return 'depart';
  if (type >= 4 && type <= 6) return 'arrive';
  if (type === 9 || type === 10 || type === 11) return 'right';
  if (type === 12) return 'uturn';
  if (type === 13 || type === 14 || type === 15) return 'left';
  if (type >= 26 && type <= 27) return 'roundabout';
  if (type >= 16 && type <= 25) return type === 18 || type === 19 ? 'ramp' : type === 20 || type === 21 ? 'exit' : type >= 22 && type <= 24 ? 'straight' : 'merge';
  if (type >= 28 && type <= 29) return 'ferry';
  return 'straight';
}

function valhallaTrip(trip: ValhallaTrip | undefined): Route | null {
  if (!trip?.legs?.length) return null;
  const coords: [number, number][] = [];
  const steps: Route['steps'] = [];
  for (const leg of trip.legs) {
    const shape = decodePolyline(leg.shape ?? '', 6);
    const offset = coords.length ? coords.length - 1 : 0;
    coords.push(...(coords.length ? shape.slice(1) : shape));
    for (const m of leg.maneuvers ?? []) {
      steps.push({
        instruction: m.instruction ?? '',
        distanceM: Math.round((m.length ?? 0) * 1000),
        durationS: Math.round(m.time ?? 0),
        maneuver: valhallaManeuver(m.type ?? 0),
        startIndex: offset + (m.begin_shape_index ?? 0),
      });
    }
  }
  if (coords.length < 2) return null;
  return {
    distanceM: Math.round((trip.summary?.length ?? 0) * 1000),
    durationS: Math.round(trip.summary?.time ?? 0),
    geometry: { type: 'LineString', coordinates: coords },
    steps,
    hasToll: trip.summary?.has_toll ?? false,
    hasHighway: trip.summary?.has_highway ?? false,
    hasFerry: trip.summary?.has_ferry ?? false,
  };
}

export function normalizeValhalla(body: ValhallaBody): Route[] {
  return [valhallaTrip(body.trip), ...(body.alternates ?? []).map((a) => valhallaTrip(a.trip))].filter((r): r is Route => r !== null);
}

export function valhallaRequest(points: LatLng[], mode: Mode, avoid: Avoid) {
  const costing = VALHALLA_COSTING[mode];
  const opts: Record<string, number> = {};
  if (avoid.tolls) opts.use_tolls = 0;
  if (avoid.highways) opts.use_highways = 0;
  if (avoid.ferries) opts.use_ferry = 0;
  return {
    locations: points.map((p, i) => ({ lat: p.lat, lon: p.lng, type: i === 0 || i === points.length - 1 ? 'break' : 'through' })),
    costing,
    ...(Object.keys(opts).length ? { costing_options: { [costing]: opts } } : {}),
    // Valhalla only offers alternates between two locations.
    ...(points.length === 2 ? { alternates: 2 } : {}),
    directions_options: { units: 'kilometers', language: 'en-US' },
  };
}

async function valhallaRoute(points: LatLng[], mode: Mode, avoid: Avoid): Promise<Route[]> {
  const { data } = await httpJson<ValhallaBody>(`${valhallaBase()}/route`, {
    method: 'POST',
    body: JSON.stringify(valhallaRequest(points, mode, avoid)),
    headers: { 'content-type': 'application/json' },
    timeoutMs: 12_000,
    limiter: valhallaBucket(),
  });
  const routes = normalizeValhalla(data ?? {});
  if (!routes.length) throw new HttpError('Valhalla returned no trip', 'parse', valhallaBase());
  return routes;
}

// ── OSRM ────────────────────────────────────────────────────────────────────────
export interface OsrmStep {
  name?: string;
  distance?: number;
  duration?: number;
  maneuver?: { type?: string; modifier?: string; exit?: number };
  geometry?: { coordinates?: [number, number][] };
}
export interface OsrmBody {
  code?: string;
  routes?: { distance?: number; duration?: number; geometry?: { coordinates?: [number, number][] }; legs?: { steps?: OsrmStep[] }[] }[];
}

export function osrmInstruction(s: OsrmStep): string {
  const type = s.maneuver?.type ?? '';
  const mod = s.maneuver?.modifier ?? '';
  const road = (s.name ?? '').trim();
  const onto = road ? ` onto ${road}` : '';
  switch (type) {
    case 'depart':
      return road ? `Head ${mod || 'out'} on ${road}` : 'Depart';
    case 'arrive':
      return 'Arrive at your destination';
    case 'roundabout':
    case 'rotary':
      return s.maneuver?.exit ? `At the roundabout, take exit ${s.maneuver.exit}${onto}` : `Enter the roundabout${onto}`;
    case 'merge':
      return `Merge${mod ? ` ${mod}` : ''}${onto}`;
    case 'on ramp':
      return `Take the ramp${onto}`;
    case 'off ramp':
      return `Take the exit${onto}`;
    case 'fork':
      return `Keep ${mod || 'straight'} at the fork${onto}`;
    case 'end of road':
      return `At the end of the road, turn ${mod || 'straight'}${onto}`;
    case 'continue':
    case 'new name':
      return mod && mod !== 'straight' && type === 'continue' ? `Keep ${mod}${onto}` : `Continue${onto}`;
    default:
      return mod ? `Turn ${mod}${onto}` : `Continue${onto}`;
  }
}

export function normalizeOsrm(body: OsrmBody): Route[] {
  return (body.routes ?? [])
    .map((r): Route | null => {
      const coords = r.geometry?.coordinates ?? [];
      if (coords.length < 2) return null;
      const steps: Route['steps'] = [];
      let idx = 0;
      for (const leg of r.legs ?? []) {
        for (const s of leg.steps ?? []) {
          steps.push({ instruction: osrmInstruction(s), distanceM: Math.round(s.distance ?? 0), durationS: Math.round(s.duration ?? 0), maneuver: s.maneuver?.modifier ?? s.maneuver?.type ?? null, startIndex: idx });
          idx += Math.max(0, (s.geometry?.coordinates?.length ?? 1) - 1);
        }
      }
      // OSRM does not report tolls/highways/ferries in the default response: false means "not reported".
      return { distanceM: Math.round(r.distance ?? 0), durationS: Math.round(r.duration ?? 0), geometry: { type: 'LineString', coordinates: coords }, steps, hasToll: false, hasHighway: false, hasFerry: false };
    })
    .filter((r): r is Route => r !== null);
}

async function osrmRoute(points: LatLng[], mode: Mode): Promise<Route[]> {
  const coords = points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const url = `${osrmBase(mode)}/route/v1/driving/${coords}?overview=full&steps=true&geometries=geojson&alternatives=${points.length === 2 ? 'true' : 'false'}`;
  const { data } = await httpJson<OsrmBody>(url, { timeoutMs: 10_000, retries: 1, limiter: osrmBucket() });
  if (data?.code && data.code !== 'Ok') throw new HttpError(`OSRM ${data.code}`, 'http', url);
  const routes = normalizeOsrm(data ?? {});
  if (!routes.length) throw new HttpError('OSRM returned no route', 'parse', url);
  return routes;
}

// ── Elevation (Valhalla /height) ───────────────────────────────────────────────
export function elevationProfile(pairs: [number, number][]): { elevation: { distanceM: number; elevationM: number }[]; ascentM: number; descentM: number } | null {
  const elevation = pairs.filter(([d, h]) => Number.isFinite(d) && Number.isFinite(h)).map(([d, h]) => ({ distanceM: d, elevationM: h }));
  if (elevation.length < 2) return null;
  let ascent = 0;
  let descent = 0;
  for (let i = 1; i < elevation.length; i++) {
    const d = elevation[i]!.elevationM - elevation[i - 1]!.elevationM;
    if (d > 0) ascent += d;
    else descent -= d;
  }
  return { elevation, ascentM: Math.round(ascent), descentM: Math.round(descent) };
}

async function fetchElevation(coords: [number, number][]) {
  const stride = Math.max(1, Math.ceil(coords.length / 120));
  const shape = coords.filter((_, i) => i % stride === 0 || i === coords.length - 1).map(([lon, lat]) => ({ lat, lon }));
  const { data } = await httpJson<{ range_height?: [number, number][] }>(`${valhallaBase()}/height`, {
    method: 'POST',
    body: JSON.stringify({ range: true, shape }),
    headers: { 'content-type': 'application/json' },
    timeoutMs: 10_000,
    limiter: valhallaBucket(),
  });
  const prof = elevationProfile(data?.range_height ?? []);
  if (!prof) throw new HttpError('No elevation profile', 'parse', valhallaBase());
  return prof;
}

// ── Orchestration ───────────────────────────────────────────────────────────────
export interface DirectionsResult {
  engine: 'valhalla' | 'osrm' | null;
  routes: Route[];
  elevation: DirectionsResponse['elevation'];
  ascentM: number | null;
  descentM: number | null;
  providers: Providers;
}

const key = (points: LatLng[], mode: Mode, avoid: Avoid) => `${mode}:${points.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('|')}:${Number(avoid.tolls)}${Number(avoid.highways)}${Number(avoid.ferries)}`;

export async function directions(points: LatLng[], mode: Mode, avoid: Avoid): Promise<DirectionsResult> {
  const providers: Providers = {};
  const k = key(points, mode, avoid);
  const v = await probe(`dir:valhalla:${k}`, 5 * 60_000, () => valhallaRoute(points, mode, avoid), { count: (r) => r.length });
  providers.valhalla = v.status;
  let engine: DirectionsResult['engine'] = v.value ? 'valhalla' : null;
  let routes = v.value ?? [];
  if (!routes.length) {
    const o = await probe(`dir:osrm:${k}`, 5 * 60_000, () => osrmRoute(points, mode), { count: (r) => r.length });
    providers.osrm = o.status;
    if (o.value) {
      engine = 'osrm';
      routes = o.value;
    }
  }
  let elevation: DirectionsResult['elevation'] = null;
  let ascentM: number | null = null;
  let descentM: number | null = null;
  // Elevation matters on foot and by bike; driving skips the extra call.
  if (routes.length && mode !== 'drive') {
    const e = await probe(`dir:height:${k}`, 5 * 60_000, () => fetchElevation(routes[0]!.geometry.coordinates as [number, number][]), { count: (p) => p.elevation.length });
    providers['valhalla-height'] = e.status;
    if (e.value) ({ elevation, ascentM, descentM } = e.value);
  }
  return { engine, routes, elevation, ascentM, descentM, providers };
}
