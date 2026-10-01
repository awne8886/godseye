/**
 * Pure provider adapters: one upstream camera list → Camera rows. No I/O here (loaders.ts fetches),
 * so every adapter is unit-tested against a recorded fixture (__fixtures__, captured 2026-09-30).
 *
 * Honesty: `observedAt` is set only when the operator publishes the image time in its list
 * (LTA `timestamp`, DriveBC `last_update_modified`, Trafikverket `PhotoTime`). Inventory record
 * dates (Caltrans `recordTimestamp`, DGT `fecha`, TfL `modified`) are metadata, not frame times,
 * so they are NOT used; the viewer shows "time not published by operator" or the frame's own
 * Last-Modified from the stills proxy instead. Upstream strings are plain text (toPlainText).
 *
 * Hostile bodies (round 5): every adapter takes `unknown` and checks the shape it reads. A body of
 * `null`, an array where an object is expected (or the reverse), a string, a number, null elements
 * or fields of the wrong type yield no rows for that record, never a thrown TypeError. The loaders
 * refuse a wrong top-level shape first (`parse`: SOURCE OFFLINE with the last good rows).
 * Owner: layers-surveillance.
 */
import { decodeEntities, toPlainText } from '@/lib/rss';
import type { Camera } from '@/lib/types';

type Row = Camera;
type Rec = Record<string, unknown>;

/** A JSON object, or null for null, arrays, strings, numbers and booleans. */
export function asRecord(v: unknown): Rec | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Rec) : null;
}

/** The object elements of `v` when it is an array (anything else → []; null/primitive elements dropped). */
export function records<T extends object = Rec>(v: unknown): T[] {
  return Array.isArray(v) ? (v.filter((x) => asRecord(x) !== null) as T[]) : [];
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** An identifier: a non-empty string, or an integer written as one (objects never become ids). */
const idOf = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : typeof v === 'number' && Number.isInteger(v) ? String(v) : null);

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

const validLatLng = (lat: number | null, lng: number | null): lat is number =>
  lat !== null && lng !== null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !(lat === 0 && lng === 0);

const text = (v: unknown): string => (typeof v === 'string' ? toPlainText(v) : typeof v === 'number' ? String(v) : '');

const https = (u: unknown): string | null => {
  if (typeof u !== 'string') return null;
  try {
    const url = new URL(u.trim());
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
};

/** ISO UTC from a timestamp carrying an explicit offset or Z; null when zone-less or invalid. */
export function isoWithOffset(v: unknown): string | null {
  if (typeof v !== 'string' || !/(Z|[+-]\d{2}:?\d{2})$/.test(v.trim())) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

const HEADINGS: Record<string, number> = { n: 0, north: 0, northbound: 0, ne: 45, e: 90, east: 90, eastbound: 90, se: 135, s: 180, south: 180, southbound: 180, sw: 225, w: 270, west: 270, westbound: 270, nw: 315 };
export function headingOf(dir: unknown): number | null {
  if (typeof dir !== 'string') return null;
  return HEADINGS[dir.trim().toLowerCase()] ?? null;
}

function cam(p: Omit<Row, 'city' | 'country' | 'stillUrl' | 'streamUrl' | 'externalUrl' | 'headingDeg' | 'observedAt'> & Partial<Row>): Row {
  return { city: null, country: null, stillUrl: null, streamUrl: null, externalUrl: null, headingDeg: null, observedAt: null, ...p };
}

// ── US West ─────────────────────────────────────────────────────────────────────
interface CaltransRecord {
  cctv?: {
    index?: string;
    inService?: string;
    location?: { district?: string; locationName?: string; nearbyPlace?: string; county?: string; latitude?: string; longitude?: string; direction?: string };
    imageData?: { streamingVideoURL?: string; static?: { currentImageURL?: string } };
  };
}

/** Caltrans CWWP2 per-district JSON (`cctvStatusDNN.json`); HLS from `streamingVideoURL` where present. */
export function parseCaltrans(raw: unknown, district: number): Row[] {
  const out: Row[] = [];
  for (const r of records<CaltransRecord>(asRecord(raw)?.data)) {
    const c = asRecord(r.cctv) as CaltransRecord['cctv'] | null;
    if (!c || c.inService !== 'true') continue;
    const lat = num(c.location?.latitude);
    const lng = num(c.location?.longitude);
    if (!validLatLng(lat, lng)) continue;
    const still = https(c.imageData?.static?.currentImageURL);
    const hls = https(c.imageData?.streamingVideoURL);
    const stream = hls && /\.m3u8(\?|$)/.test(hls) ? hls : null;
    if (!still && !stream) continue;
    out.push(
      cam({
        id: `caltrans-d${district}-${idOf(c.index) ?? out.length}`,
        lat,
        lng: lng!,
        source: 'caltrans',
        providerId: 'caltrans',
        name: text(c.location?.locationName) || `Caltrans D${district} camera ${idOf(c.index) ?? out.length}`,
        city: text(c.location?.nearbyPlace) || text(c.location?.county) || null,
        country: 'US',
        streamType: stream ? 'hls' : 'jpg',
        stillUrl: still,
        streamUrl: stream,
        externalUrl: 'https://quickmap.dot.ca.gov/',
        headingDeg: headingOf(c.location?.direction),
      }),
    );
  }
  return out;
}

/** WSDOT keyless KML (`HighwayCameras/kml.aspx`); only frames on WSDOT's own image host are kept. */
export function parseWsdotKml(kml: unknown): Row[] {
  const out: Row[] = [];
  if (typeof kml !== 'string') return out;
  for (const m of kml.matchAll(/<Placemark\s+id="ID\s*(\d+)">([\s\S]*?)<\/Placemark>/g)) {
    const [, id, body] = m as unknown as [string, string, string];
    const coords = body.match(/<coordinates>\s*([-\d.]+),([-\d.]+)/);
    const src = body.match(/src="(https:\/\/images\.wsdot\.wa\.gov\/[^"]+)"/);
    if (!coords || !src) continue;
    const lng = num(coords[1]);
    const lat = num(coords[2]);
    if (!validLatLng(lat, lng)) continue;
    const name = toPlainText(body.match(/<name>([\s\S]*?)<\/name>/)?.[1] ?? '');
    out.push(cam({ id: `wsdot-${id}`, lat, lng: lng!, source: 'wsdot', providerId: 'wsdot', name: name || `WSDOT camera ${id}`, country: 'US', streamType: 'jpg', stillUrl: decodeEntities(src[1]!) }));
  }
  return out;
}

interface EsriFeatureSet {
  features?: { attributes?: { cameraId?: number; publishedImageId?: number; filename?: string; latitude?: number; longitude?: number; route?: string; title?: string } }[];
}

/** A single path segment ending in .jpg/.jpeg: no slashes, no `..`, no control characters. */
export function safeFileName(f: string): boolean {
  return f.length <= 120 && /\.jpe?g$/i.test(f) && !/[/\\]/.test(f) && !f.includes('..') && [...f].every((ch) => ch.charCodeAt(0) >= 32);
}

type EsriFeature = NonNullable<EsriFeatureSet['features']>[number];

/** ODOT TripCheck `cctvinventory.js` (an Esri FeatureSet served as JavaScript text). */
export function parseOdot(raw: unknown): Row[] {
  const out: Row[] = [];
  const seen = new Set<string>();
  for (const f of records<EsriFeature>(asRecord(raw)?.features)) {
    const a = asRecord(f.attributes) as EsriFeature['attributes'] | null;
    // Real filenames carry spaces and '@' ("I-5@Goshen_pid1504.jpg"); refuse only path tricks.
    if (!a || typeof a.filename !== 'string' || !safeFileName(a.filename) || seen.has(a.filename)) continue;
    const lat = num(a.latitude);
    const lng = num(a.longitude);
    if (!validLatLng(lat, lng)) continue;
    seen.add(a.filename);
    out.push(
      cam({
        id: `odot-${idOf(a.cameraId) ?? 0}-${idOf(a.publishedImageId) ?? seen.size}`,
        lat,
        lng: lng!,
        source: 'odot',
        providerId: 'odot',
        name: text(a.title) || text(a.route) || a.filename,
        country: 'US',
        streamType: 'jpg',
        stillUrl: `https://tripcheck.com/RoadCams/cams/${encodeURIComponent(a.filename)}`,
        externalUrl: 'https://www.tripcheck.com/',
      }),
    );
  }
  return out;
}

// ── Texas ───────────────────────────────────────────────────────────────────────
interface TxdotCamera {
  icd_Id?: string;
  name?: string;
  latitude?: number;
  longitude?: number;
  hasSnapshot?: boolean;
  netId?: string;
  dirDescription?: string;
}

export const TXDOT_DISTRICTS = ['ABL', 'AMA', 'ATL', 'AUS', 'BMT', 'BWD', 'BRY', 'CHS', 'CRP', 'DAL', 'ELP', 'FTW', 'HOU', 'LRD', 'LBB', 'LFK', 'ODA', 'PAR', 'PHR', 'SJT', 'SAT', 'TYL', 'WAC', 'WFS', 'YKM'] as const;

export function txdotSnapshotUrl(district: string, icdId: string): string {
  return `https://its.txdot.gov/its/DistrictIts/GetCctvSnapshotByIcdId?districtCode=${encodeURIComponent(district)}&icdId=${encodeURIComponent(icdId)}`;
}

/** `txdot-<DISTRICT>-<icd_Id>` → parts (null when malformed). */
export function parseTxdotId(id: string): { district: string; icdId: string } | null {
  const m = id.match(/^txdot-([A-Z]{3})-(.{1,120})$/);
  if (!m || !(TXDOT_DISTRICTS as readonly string[]).includes(m[1]!)) return null;
  return { district: m[1]!, icdId: m[2]! };
}

/**
 * TxDOT `GetCctvStatusListByDistrict` (2026 shape): cameras live in `roadwayCctvStatuses`
 * (roadway → cameras) and, on some districts, `cctvStatusRoadways[].ctts[]`. Only cameras with
 * `hasSnapshot` are kept; frames come through /api/cctv/texas/snapshot (base64 JPEG in JSON).
 */
export function parseTxdot(raw: unknown, district: string): Row[] {
  const body = asRecord(raw);
  const all: TxdotCamera[] = [
    ...Object.values(asRecord(body?.roadwayCctvStatuses) ?? {}).flatMap((list) => records<TxdotCamera>(list)),
    ...records<{ ctts?: unknown }>(body?.cctvStatusRoadways).flatMap((r) => records<TxdotCamera>(r.ctts)),
  ];
  const out: Row[] = [];
  const seen = new Set<string>();
  for (const c of all) {
    if (typeof c.icd_Id !== 'string' || !c.icd_Id || c.hasSnapshot !== true || seen.has(c.icd_Id) || c.icd_Id.length > 120) continue;
    const lat = num(c.latitude);
    const lng = num(c.longitude);
    if (!validLatLng(lat, lng)) continue;
    seen.add(c.icd_Id);
    out.push(
      cam({
        id: `txdot-${district}-${c.icd_Id}`,
        lat,
        lng: lng!,
        source: 'txdot',
        providerId: 'txdot',
        name: text(c.name) || c.icd_Id,
        country: 'US',
        streamType: 'jpg',
        stillUrl: txdotSnapshotUrl(district, c.icd_Id),
        externalUrl: `https://its.txdot.gov/its/District/${district}/cameras`,
        headingDeg: headingOf(c.dirDescription),
      }),
    );
  }
  return out;
}

// ── US Midwest ──────────────────────────────────────────────────────────────────
/** MDOT Mi Drive camera list: coordinates and id live inside HTML fragments. */
export function parseMdot(raw: unknown): Row[] {
  const out: Row[] = [];
  for (const r of records<{ route?: unknown; location?: unknown; county?: unknown; image?: unknown }>(raw)) {
    const countyHtml = str(r.county) ?? '';
    const m = countyHtml.match(/lat=([-\d.]+)&(?:amp;)?lon=([-\d.]+)[^"]*?id=(\d+)/);
    const src = (str(r.image) ?? '').match(/src="(https:\/\/micamerasimages\.net\/[^"]+)"/);
    if (!m || !src) continue;
    const lat = num(m[1]);
    const lng = num(m[2]);
    if (!validLatLng(lat, lng)) continue;
    const county = toPlainText(countyHtml.replace(/<a[\s\S]*<\/a>/, ''));
    out.push(
      cam({
        id: `mdot-${m[3]}`,
        lat,
        lng: lng!,
        source: 'mdot',
        providerId: 'mdot',
        name: `${text(r.route)}${text(r.location) ? ` ${text(r.location)}` : ''}`.trim() || `MDOT camera ${m[3]}`,
        city: county || null,
        country: 'US',
        streamType: 'jpg',
        stillUrl: decodeEntities(src[1]!),
        externalUrl: `https://mdotjboss.state.mi.us/MiDrive/map?cameras=true&lat=${lat}&lon=${lng}&zoom=15&id=${m[3]}`,
      }),
    );
  }
  return out;
}

// ── Canada ──────────────────────────────────────────────────────────────────────
interface IndotFeature {
  uri?: string;
  title?: string;
  active?: boolean;
  features?: { geometry?: { type?: string; coordinates?: unknown } }[];
  views?: { category?: string; url?: string }[];
}

/** INDOT poster frames on the CARS program image host (`…/cameras/IN/INDOT_<n>_<token>.flv.png`, served as JPEG). */
const INDOT_STILL = /^https:\/\/public\.carsprogram\.org\/cameras\/IN\/(?:INDOT|InDOT)_\d{1,6}_[\w-]{4,40}\.flv\.png$/;

/**
 * INDOT 511in.org GraphQL `mapFeaturesQuery` (keyless, probed 2026-10-01): active cameras with a
 * poster frame. Closed cameras carry a site icon instead of a frame and are skipped. The HLS edge
 * is not used: its first ~20 s are a pre-roll filler.
 */
export function parseIndot(raw: unknown): Row[] {
  const out: Row[] = [];
  const features = asRecord(asRecord(asRecord(raw)?.data)?.mapFeaturesQuery)?.mapFeatures;
  for (const f of records<IndotFeature>(features)) {
    const id = (str(f.uri) ?? '').match(/^camera\/(\d{1,9})$/)?.[1];
    const still = str(records<{ url?: unknown }>(f.views)[0]?.url);
    const pt = pointOf(records<{ geometry?: unknown }>(f.features)[0]?.geometry);
    if (!id || f.active !== true || !still || !INDOT_STILL.test(still) || !pt) continue;
    out.push(cam({ id: `indot-${id}`, lat: pt[1], lng: pt[0], source: 'indot', providerId: 'indot', name: text(f.title) || `INDOT camera ${id}`, country: 'US', streamType: 'jpg', stillUrl: still }));
  }
  return out;
}

export function parseOttawa(raw: unknown): Row[] {
  const out: Row[] = [];
  for (const r of records<{ number?: unknown; latitude?: unknown; longitude?: unknown; description?: unknown }>(raw)) {
    const lat = num(r.latitude);
    const lng = num(r.longitude);
    if (!Number.isInteger(r.number) || !validLatLng(lat, lng)) continue;
    out.push(cam({ id: `ottawa-${r.number}`, lat, lng: lng!, source: 'ottawa', providerId: 'ottawa', name: text(r.description) || `Ottawa camera ${r.number}`, city: 'Ottawa', country: 'CA', streamType: 'jpg', stillUrl: `https://traffic.ottawa.ca/map/camera?id=${r.number}`, externalUrl: null }));
  }
  return out;
}

interface GeoJsonPoints {
  features?: { id?: string | number; geometry?: { type?: string; coordinates?: unknown }; properties?: Record<string, unknown> }[];
}

function pointOf(geometry: unknown): [number, number] | null {
  const g = asRecord(geometry);
  const c = g?.type === 'MultiPoint' ? (Array.isArray(g.coordinates) ? (g.coordinates as unknown[])[0] : null) : g?.coordinates;
  if (!Array.isArray(c)) return null;
  const lng = num(c[0]);
  const lat = num(c[1]);
  return validLatLng(lat, lng) ? [lng!, lat] : null;
}

/** The features of a GeoJSON FeatureCollection body (anything else → []). */
const featuresOf = (raw: unknown) => records<NonNullable<GeoJsonPoints['features']>[number]>(asRecord(raw)?.features);

/** Québec 511 WFS: cameras are listed with their operator page only (frames refuse non-browser clients). */
export function parseQuebec(raw: unknown): Row[] {
  const out: Row[] = [];
  for (const f of featuresOf(raw)) {
    const p = asRecord(f.properties) ?? {};
    const pt = pointOf(f.geometry);
    const id = text(p.IDEcamera) || idOf(f.id) || '';
    const page = https(p.URL_FLUX_DONNEE);
    if (!pt || !id || !page) continue;
    out.push(
      cam({
        id: `quebec-${id}`,
        lat: pt[1],
        lng: pt[0],
        source: 'quebec',
        providerId: 'quebec',
        name: text(p.DescriptionLocalisationEn) || text(p.DescriptionLocalisationFr) || `Québec 511 camera ${id}`,
        city: text(p.NomRegionDiffusion) || null,
        country: 'CA',
        streamType: 'link',
        externalUrl: page,
      }),
    );
  }
  return out;
}

export function parseToronto(raw: unknown): Row[] {
  const out: Row[] = [];
  for (const f of featuresOf(raw)) {
    const p = asRecord(f.properties) ?? {};
    const pt = pointOf(f.geometry);
    const still = https(p.IMAGEURL);
    const id = num(p.REC_ID);
    if (!pt || !still || id === null) continue;
    const name = [text(p.MAINROAD), text(p.CROSSROAD)].filter(Boolean).join(' / ');
    out.push(cam({ id: `toronto-${id}`, lat: pt[1], lng: pt[0], source: 'toronto', providerId: 'toronto', name: name || `Toronto camera ${id}`, city: 'Toronto', country: 'CA', streamType: 'jpg', stillUrl: still }));
  }
  return out;
}

interface DriveBcCam {
  id?: number;
  name?: string;
  caption?: string;
  links?: { imageDisplay?: string };
  location?: { coordinates?: [number, number] };
  is_on?: boolean;
  should_appear?: boolean;
  region_name?: string;
  orientation?: string;
  last_update_modified?: string;
}

/** DriveBC `/api/webcams/` (new URL): `last_update_modified` is the operator's image time. */
export function parseDriveBc(raw: unknown): Row[] {
  const out: Row[] = [];
  for (const r of records<DriveBcCam>(raw)) {
    if (!Number.isInteger(r.id) || r.is_on === false || r.should_appear === false) continue;
    const coords: unknown = asRecord(r.location)?.coordinates;
    const lng = num(Array.isArray(coords) ? coords[0] : null);
    const lat = num(Array.isArray(coords) ? coords[1] : null);
    const path = str(asRecord(r.links)?.imageDisplay)?.split('?')[0];
    if (!validLatLng(lat, lng) || !path || !/^\/images\/\d+\.jpg$/.test(path)) continue;
    out.push(
      cam({
        id: `drivebc-${r.id}`,
        lat,
        lng: lng!,
        source: 'drivebc',
        providerId: 'drivebc',
        name: text(r.name) || `DriveBC camera ${r.id}`,
        city: text(r.region_name) || null,
        country: 'CA',
        streamType: 'jpg',
        stillUrl: `https://www.drivebc.ca${path}`,
        externalUrl: 'https://www.drivebc.ca/',
        headingDeg: headingOf(r.orientation),
        observedAt: isoWithOffset(r.last_update_modified),
      }),
    );
  }
  return out;
}

// ── UK ──────────────────────────────────────────────────────────────────────────
interface TflPlace {
  id?: string;
  commonName?: string;
  lat?: number;
  lon?: number;
  additionalProperties?: { key?: string; value?: string }[];
}

/** TfL JamCams (`/Place/Type/JamCam`): still + short mp4 clip ("latest clip", never "live"). */
export function parseTfl(raw: unknown): Row[] {
  const out: Row[] = [];
  for (const p of records<TflPlace>(raw)) {
    const props: Record<string, string> = {};
    for (const a of records<{ key?: unknown; value?: unknown }>(p.additionalProperties)) if (typeof a.key === 'string' && typeof a.value === 'string') props[a.key] = a.value;
    const id = str(p.id)?.replace(/^JamCams_/, '');
    const lat = num(p.lat);
    const lng = num(p.lon);
    if (!id || !/^[\w.]+$/.test(id) || props.available === 'false' || !validLatLng(lat, lng)) continue;
    const still = https(props.imageUrl);
    const clip = https(props.videoUrl);
    if (!still) continue;
    out.push(
      cam({
        id: `tfl-${id}`,
        lat,
        lng: lng!,
        source: 'tfl',
        providerId: 'tfl',
        name: text(p.commonName) || `JamCam ${id}`,
        city: 'London',
        country: 'GB',
        streamType: clip ? 'mp4' : 'jpg',
        stillUrl: still,
        streamUrl: clip,
        headingDeg: headingOf(props.view),
      }),
    );
  }
  return out;
}

// ── Europe ──────────────────────────────────────────────────────────────────────
export function parseDgt(raw: unknown): Row[] {
  const out: Row[] = [];
  for (const c of records<{ id?: unknown; latitud?: unknown; longitud?: unknown; carretera?: unknown; pk?: unknown; sentido?: unknown; imagen?: unknown }>(asRecord(raw)?.camaras)) {
    const lat = num(c.latitud);
    const lng = num(c.longitud);
    const still = https(c.imagen);
    const id = idOf(c.id);
    if (!id || !/^\d+$/.test(id) || !still || !validLatLng(lat, lng)) continue;
    const dir = text(c.sentido) && c.sentido !== '-' ? ` (${text(c.sentido)})` : '';
    out.push(cam({ id: `dgt-${id}`, lat, lng: lng!, source: 'dgt', providerId: 'dgt', name: `${text(c.carretera)} km ${text(c.pk)}${dir}`.trim(), country: 'ES', streamType: 'jpg', stillUrl: still }));
  }
  return out;
}

/** Rijkswaterstaat (`/api/cameras/`, new URL): frames need a browser Referer, so link out only. */
export function parseRws(raw: unknown): Row[] {
  const out: Row[] = [];
  for (const c of records<{ id?: unknown; latitude?: unknown; longitude?: unknown; road?: unknown; near?: unknown; stream_url?: unknown }>(raw)) {
    const lat = num(c.latitude);
    const lng = num(c.longitude);
    const page = https(c.stream_url);
    if (!Number.isInteger(c.id) || !page || !validLatLng(lat, lng)) continue;
    out.push(cam({ id: `rws-${c.id}`, lat, lng: lng!, source: 'rws', providerId: 'rws', name: [text(c.road), text(c.near)].filter(Boolean).join(' — ') || `RWS camera ${c.id}`, city: text(c.near) || null, country: 'NL', streamType: 'link', externalUrl: page }));
  }
  return out;
}

// ── Nordics ─────────────────────────────────────────────────────────────────────
export function parseDigitraffic(raw: unknown): Row[] {
  const out: Row[] = [];
  for (const f of featuresOf(raw)) {
    const p = asRecord(f.properties) ?? {};
    if (p.collectionStatus !== 'GATHERING') continue;
    const preset = records<{ id?: unknown; inCollection?: unknown }>(p.presets).find((x) => x.inCollection === true && typeof x.id === 'string' && /^[A-Z]\d+$/.test(x.id));
    const pt = pointOf(f.geometry);
    if (typeof preset?.id !== 'string' || !pt) continue;
    out.push(
      cam({
        id: `digitraffic-${preset.id}`,
        lat: pt[1],
        lng: pt[0],
        source: 'digitraffic',
        providerId: 'digitraffic',
        name: text(p.name).replace(/_/g, ' ') || preset.id,
        country: 'FI',
        streamType: 'jpg',
        stillUrl: `https://weathercam.digitraffic.fi/${preset.id}.jpg`,
      }),
    );
  }
  return out;
}

export function parseVegagerdin(raw: unknown): Row[] {
  const out: Row[] = [];
  const seen = new Set<string>();
  for (const c of records<{ Myndavel?: unknown; Skyring?: unknown; Slod?: unknown; Breidd?: unknown; Lengd?: unknown }>(raw)) {
    const still = https(c.Slod);
    const lat = num(c.Breidd);
    const lng = num(c.Lengd);
    const key = still?.match(/\/vefmyndavelar\/([\w.-]+)\.jpg$/i)?.[1];
    if (!still || !key || seen.has(key) || !validLatLng(lat, lng)) continue;
    seen.add(key);
    out.push(cam({ id: `vegagerdin-${key}`, lat, lng: lng!, source: 'vegagerdin', providerId: 'vegagerdin', name: text(c.Skyring) || text(c.Myndavel) || key, city: text(c.Myndavel) || null, country: 'IS', streamType: 'jpg', stillUrl: still, externalUrl: null }));
  }
  return out;
}

interface TrafikverketResponse {
  RESPONSE?: { RESULT?: { Camera?: { Id?: string; Name?: string; Active?: boolean; Geometry?: { WGS84?: string }; PhotoUrl?: string; PhotoTime?: string; HasFullSizePhoto?: boolean; Direction?: number }[] }[] };
}

type TrafikverketCamera = NonNullable<NonNullable<NonNullable<TrafikverketResponse['RESPONSE']>['RESULT']>[number]['Camera']>[number];

/** Trafikverket open API `Camera` objects (keyed; CC0). `PhotoTime` is the image time. */
export function parseTrafikverket(raw: unknown): Row[] {
  const out: Row[] = [];
  const result = records<{ Camera?: unknown }>(asRecord(asRecord(raw)?.RESPONSE)?.RESULT)[0];
  for (const c of records<TrafikverketCamera>(result?.Camera)) {
    const m = (str(asRecord(c.Geometry)?.WGS84) ?? '').match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/);
    const photo = https(c.PhotoUrl);
    if (typeof c.Id !== 'string' || !/^[\w-]{1,60}$/.test(c.Id) || c.Active === false || !m || !photo) continue;
    const lng = num(m[1]);
    const lat = num(m[2]);
    if (!validLatLng(lat, lng)) continue;
    out.push(
      cam({
        id: `trafikverket-${c.Id}`,
        lat,
        lng: lng!,
        source: 'trafikverket',
        providerId: 'trafikverket',
        name: text(c.Name) || c.Id,
        country: 'SE',
        streamType: 'jpg',
        stillUrl: c.HasFullSizePhoto === true ? `${photo}${photo.includes('?') ? '&' : '?'}type=fullsize` : photo,
        headingDeg: typeof c.Direction === 'number' && c.Direction >= 0 && c.Direction < 360 ? c.Direction : null,
        observedAt: isoWithOffset(c.PhotoTime),
      }),
    );
  }
  return out;
}

// ── Asia ────────────────────────────────────────────────────────────────────────
function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? toPlainText(m[1]!) : null;
}

export function parseHongKong(xml: unknown): Row[] {
  const out: Row[] = [];
  if (typeof xml !== 'string') return out;
  for (const m of xml.matchAll(/<image>([\s\S]*?)<\/image>/g)) {
    const b = m[1]!;
    const key = tag(b, 'key');
    const lat = num(tag(b, 'latitude'));
    const lng = num(tag(b, 'longitude'));
    const still = https(tag(b, 'url'));
    if (!key || !/^\w+$/.test(key) || !still || !validLatLng(lat, lng) || lat < 22.1 || lat > 22.6 || lng! < 113.8 || lng! > 114.5) continue;
    out.push(cam({ id: `hktd-${key}`, lat, lng: lng!, source: 'hktd', providerId: 'hktd', name: tag(b, 'description') ?? key, city: tag(b, 'district'), country: 'HK', streamType: 'jpg', stillUrl: still }));
  }
  return out;
}

interface LtaResponse {
  items?: { timestamp?: string; cameras?: { camera_id?: string; image?: string; timestamp?: string; location?: { latitude?: number; longitude?: number } }[] }[];
}

type LtaCamera = NonNullable<NonNullable<LtaResponse['items']>[number]['cameras']>[number];

/** LTA traffic images (data.gov.sg v1): each image URL is one snapshot with its own timestamp. */
export function parseLta(raw: unknown): Row[] {
  const out: Row[] = [];
  for (const c of records<LtaCamera>(records<{ cameras?: unknown }>(asRecord(raw)?.items)[0]?.cameras)) {
    const loc = asRecord(c.location);
    const lat = num(loc?.latitude);
    const lng = num(loc?.longitude);
    const still = https(c.image);
    const id = idOf(c.camera_id);
    if (!id || !/^\d+$/.test(id) || !still || !validLatLng(lat, lng)) continue;
    out.push(cam({ id: `lta-${id}`, lat, lng: lng!, source: 'lta', providerId: 'lta', name: `LTA traffic camera ${id}`, city: 'Singapore', country: 'SG', streamType: 'jpg', stillUrl: still, observedAt: isoWithOffset(c.timestamp) }));
  }
  return out;
}

/** Taiwan THB provincial highways: frames at `{html}/snapshot` on the cctv-ssNN encoders only. */
export function parseThb(raw: unknown): Row[] {
  const out: Row[] = [];
  for (const c of records<{ id?: unknown; stakenumber?: unknown; gisx?: unknown; gisy?: unknown; html?: unknown }>(raw)) {
    const lat = num(c.gisy);
    const lng = num(c.gisx);
    const base = https(c.html);
    const id = idOf(c.id);
    if (!id || !/^[\w-]+$/.test(id) || !base || !validLatLng(lat, lng)) continue;
    const u = new URL(base);
    if (!/^cctv-ss\d{2}\.thb\.gov\.tw$/.test(u.hostname)) continue;
    out.push(cam({ id: `thb-${id}`, lat, lng: lng!, source: 'thb', providerId: 'thb', name: text(c.stakenumber) || id, country: 'TW', streamType: 'jpg', stillUrl: `${u.origin}${u.pathname.replace(/\/$/, '')}/snapshot` }));
  }
  return out;
}

interface ViaLietuvaInfo {
  id?: number;
  name?: string;
  roadName?: string;
  roadNr?: string;
  km?: number;
  date?: number;
}

/** A Via Lietuva camera whose last frame is older than this is treated as offline and not listed. */
export const VIA_LIETUVA_MAX_FRAME_AGE_MS = 6 * 3600_000;

/**
 * Via Lietuva (eismoinfo.lt, keyless, probed 2026-10-01): `layer-static-features/VKR?lks=false`
 * gives WGS84 points (`[lat, lng]`), `camera-info-table` gives road, km and the last frame time.
 * Joined on id. The list's frame time goes stale between inventory refreshes, so it only filters
 * dead cameras (no frame for 6 h) and is not shown as `observedAt`.
 */
export function parseViaLietuva(layers: unknown, info: unknown, now: number = Date.now()): Row[] {
  const byId = new Map<string, ViaLietuvaInfo>();
  for (const i of records<ViaLietuvaInfo>(info)) if (Number.isInteger(i.id)) byId.set(String(i.id), i);
  const out: Row[] = [];
  const vkr = records<{ layer?: unknown; features?: unknown }>(layers).find((l) => l.layer === 'VKR');
  for (const f of records<{ id?: unknown; name?: unknown; points?: unknown }>(vkr?.features)) {
    const fid = idOf(f.id);
    if (!fid || !/^\d{1,6}$/.test(fid)) continue;
    const i = byId.get(fid);
    if (!i || typeof i.date !== 'number' || now - i.date > VIA_LIETUVA_MAX_FRAME_AGE_MS) continue;
    const p = records<{ point?: unknown }>(f.points)[0]?.point;
    if (!Array.isArray(p)) continue;
    const lat = num(p[0]);
    const lng = num(p[1]);
    if (!validLatLng(lat, lng) || lat < 53.8 || lat > 56.5 || lng! < 20.8 || lng! > 26.9) continue;
    const road = [text(i.roadNr), text(i.roadName)].filter(Boolean).join(' ');
    out.push(
      cam({
        id: `vialietuva-${fid}`,
        lat,
        lng: lng!,
        source: 'vialietuva',
        providerId: 'vialietuva',
        name: text(i.name) || text(f.name) || `Via Lietuva camera ${fid}`,
        city: road || null,
        country: 'LT',
        streamType: 'jpg',
        stillUrl: `https://eismoinfo.lt/eismoinfo-backend/image-provider/camera/last?id=${fid}`,
      }),
    );
  }
  return out;
}

// ── Oceania ─────────────────────────────────────────────────────────────────────
/** NZTA `cameras/all` XML. Nested journey/leg/region/way blocks are removed before reading fields. */
export function parseNzta(xml: unknown): Row[] {
  const out: Row[] = [];
  if (typeof xml !== 'string') return out;
  for (const m of xml.matchAll(/<camera>([\s\S]*?)<\/camera>/g)) {
    const full = m[1]!;
    const region = full.match(/<region>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/region>/)?.[1];
    const b = full.replace(/<(journey|journeyLeg|region|way)>[\s\S]*?<\/\1>/g, '');
    if (tag(b, 'offline') === 'true' || tag(b, 'underMaintenance') === 'true') continue;
    const id = tag(b, 'id');
    const lat = num(tag(b, 'latitude'));
    const lng = num(tag(b, 'longitude'));
    const img = tag(b, 'imageUrl');
    if (!id || !/^\d+$/.test(id) || !img || !/^\/camera\/[\w.-]+\.jpg$/.test(img) || !validLatLng(lat, lng)) continue;
    const view = tag(b, 'viewUrl');
    out.push(
      cam({
        id: `nzta-${id}`,
        lat,
        lng: lng!,
        source: 'nzta',
        providerId: 'nzta',
        name: tag(b, 'name') || tag(b, 'description') || `NZTA camera ${id}`,
        city: region ? toPlainText(region) : null,
        country: 'NZ',
        streamType: 'jpg',
        stillUrl: `https://trafficnz.info${img}`,
        externalUrl: view && /^\/camera\/view\/\d+$/.test(view) ? `https://trafficnz.info${view}` : null,
        headingDeg: headingOf(tag(b, 'direction')),
      }),
    );
  }
  return out;
}

export function parseLiveTrafficNsw(raw: unknown): Row[] {
  const out: Row[] = [];
  for (const f of records<{ id?: unknown; path?: unknown; eventType?: unknown; geometry?: unknown; properties?: unknown }>(raw)) {
    if (f.eventType !== 'liveCams') continue;
    const props = asRecord(f.properties) ?? {};
    const pt = pointOf(f.geometry);
    const still = https(props.href);
    const path = str(f.path);
    const key = path && /^[\w-]+$/.test(path) ? path : idOf(f.id);
    if (!pt || !still || !key) continue;
    out.push(
      cam({
        id: `nsw-${key}`,
        lat: pt[1],
        lng: pt[0],
        source: 'nsw',
        providerId: 'nsw',
        name: text(props.title) || key,
        city: text(props.region).replace(/_/g, ' ') || null,
        country: 'AU',
        streamType: 'jpg',
        stillUrl: still,
        externalUrl: null,
        headingDeg: headingOf(props.direction),
      }),
    );
  }
  return out;
}
