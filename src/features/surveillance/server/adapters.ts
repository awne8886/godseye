/**
 * Pure provider adapters: one upstream camera list → Camera rows. No I/O here (loaders.ts fetches),
 * so every adapter is unit-tested against a recorded fixture (__fixtures__, captured 2026-09-30).
 *
 * Honesty: `observedAt` is set only when the operator publishes the image time in its list
 * (LTA `timestamp`, DriveBC `last_update_modified`, Trafikverket `PhotoTime`). Inventory record
 * dates (Caltrans `recordTimestamp`, DGT `fecha`, TfL `modified`) are metadata, not frame times,
 * so they are NOT used; the viewer shows "time not published by operator" or the frame's own
 * Last-Modified from the stills proxy instead. Upstream strings are plain text (toPlainText).
 * Owner: layers-surveillance.
 */
import { decodeEntities, toPlainText } from '@/lib/rss';
import type { Camera } from '@/lib/types';

type Row = Camera;

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
export function parseCaltrans(raw: { data?: CaltransRecord[] }, district: number): Row[] {
  const out: Row[] = [];
  for (const r of raw.data ?? []) {
    const c = r.cctv;
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
        id: `caltrans-d${district}-${c.index ?? out.length}`,
        lat,
        lng: lng!,
        source: 'caltrans',
        providerId: 'caltrans',
        name: text(c.location?.locationName) || `Caltrans D${district} camera ${c.index}`,
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
export function parseWsdotKml(kml: string): Row[] {
  const out: Row[] = [];
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

/** ODOT TripCheck `cctvinventory.js` (an Esri FeatureSet served as JavaScript text). */
export function parseOdot(raw: EsriFeatureSet): Row[] {
  const out: Row[] = [];
  const seen = new Set<string>();
  for (const f of raw.features ?? []) {
    const a = f.attributes;
    // Real filenames carry spaces and '@' ("I-5@Goshen_pid1504.jpg"); refuse only path tricks.
    if (!a?.filename || !safeFileName(a.filename) || seen.has(a.filename)) continue;
    const lat = num(a.latitude);
    const lng = num(a.longitude);
    if (!validLatLng(lat, lng)) continue;
    seen.add(a.filename);
    out.push(
      cam({
        id: `odot-${a.cameraId ?? 0}-${a.publishedImageId ?? seen.size}`,
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
export function parseTxdot(raw: { cctvStatusRoadways?: { ctts?: TxdotCamera[] }[]; roadwayCctvStatuses?: Record<string, TxdotCamera[]> }, district: string): Row[] {
  const all: TxdotCamera[] = [...Object.values(raw.roadwayCctvStatuses ?? {}).flat(), ...(raw.cctvStatusRoadways ?? []).flatMap((r) => r.ctts ?? [])];
  const out: Row[] = [];
  const seen = new Set<string>();
  for (const c of all) {
    if (!c?.icd_Id || c.hasSnapshot !== true || seen.has(c.icd_Id) || c.icd_Id.length > 120) continue;
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
export function parseMdot(raw: { route?: string; location?: string; county?: string; image?: string }[]): Row[] {
  const out: Row[] = [];
  for (const r of raw ?? []) {
    const m = r.county?.match(/lat=([-\d.]+)&(?:amp;)?lon=([-\d.]+)[^"]*?id=(\d+)/);
    const src = r.image?.match(/src="(https:\/\/micamerasimages\.net\/[^"]+)"/);
    if (!m || !src) continue;
    const lat = num(m[1]);
    const lng = num(m[2]);
    if (!validLatLng(lat, lng)) continue;
    const county = toPlainText((r.county ?? '').replace(/<a[\s\S]*<\/a>/, ''));
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
export function parseOttawa(raw: { number?: number; latitude?: number; longitude?: number; description?: string; type?: string }[]): Row[] {
  const out: Row[] = [];
  for (const r of raw ?? []) {
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

function pointOf(g: { type?: string; coordinates?: unknown } | undefined): [number, number] | null {
  const c = g?.type === 'MultiPoint' ? (g.coordinates as unknown[])?.[0] : g?.coordinates;
  if (!Array.isArray(c)) return null;
  const lng = num(c[0]);
  const lat = num(c[1]);
  return validLatLng(lat, lng) ? [lng!, lat] : null;
}

/** Québec 511 WFS: cameras are listed with their operator page only (frames refuse non-browser clients). */
export function parseQuebec(raw: GeoJsonPoints): Row[] {
  const out: Row[] = [];
  for (const f of raw.features ?? []) {
    const p = f.properties ?? {};
    const pt = pointOf(f.geometry);
    const id = text(p.IDEcamera) || String(f.id ?? '');
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

export function parseToronto(raw: GeoJsonPoints): Row[] {
  const out: Row[] = [];
  for (const f of raw.features ?? []) {
    const p = f.properties ?? {};
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
export function parseDriveBc(raw: DriveBcCam[]): Row[] {
  const out: Row[] = [];
  for (const r of raw ?? []) {
    if (!Number.isInteger(r.id) || r.is_on === false || r.should_appear === false) continue;
    const lng = num(r.location?.coordinates?.[0]);
    const lat = num(r.location?.coordinates?.[1]);
    const path = r.links?.imageDisplay?.split('?')[0];
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
export function parseTfl(raw: TflPlace[]): Row[] {
  const out: Row[] = [];
  for (const p of raw ?? []) {
    const props = Object.fromEntries((p.additionalProperties ?? []).map((a) => [a.key ?? '', a.value ?? '']));
    const id = p.id?.replace(/^JamCams_/, '');
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
export function parseDgt(raw: { camaras?: { id?: string; latitud?: string; longitud?: string; carretera?: string; pk?: string; sentido?: string; imagen?: string }[] }): Row[] {
  const out: Row[] = [];
  for (const c of raw.camaras ?? []) {
    const lat = num(c.latitud);
    const lng = num(c.longitud);
    const still = https(c.imagen);
    if (!c.id || !/^\d+$/.test(c.id) || !still || !validLatLng(lat, lng)) continue;
    const dir = c.sentido && c.sentido !== '-' ? ` (${text(c.sentido)})` : '';
    out.push(cam({ id: `dgt-${c.id}`, lat, lng: lng!, source: 'dgt', providerId: 'dgt', name: `${text(c.carretera)} km ${text(c.pk)}${dir}`.trim(), country: 'ES', streamType: 'jpg', stillUrl: still }));
  }
  return out;
}

/** Rijkswaterstaat (`/api/cameras/`, new URL): frames need a browser Referer, so link out only. */
export function parseRws(raw: { id?: number; latitude?: string; longitude?: string; road?: string; near?: string; stream_url?: string }[]): Row[] {
  const out: Row[] = [];
  for (const c of raw ?? []) {
    const lat = num(c.latitude);
    const lng = num(c.longitude);
    const page = https(c.stream_url);
    if (!Number.isInteger(c.id) || !page || !validLatLng(lat, lng)) continue;
    out.push(cam({ id: `rws-${c.id}`, lat, lng: lng!, source: 'rws', providerId: 'rws', name: [text(c.road), text(c.near)].filter(Boolean).join(' — ') || `RWS camera ${c.id}`, city: text(c.near) || null, country: 'NL', streamType: 'link', externalUrl: page }));
  }
  return out;
}

// ── Nordics ─────────────────────────────────────────────────────────────────────
export function parseDigitraffic(raw: GeoJsonPoints): Row[] {
  const out: Row[] = [];
  for (const f of raw.features ?? []) {
    const p = f.properties ?? {};
    if (p.collectionStatus !== 'GATHERING') continue;
    const preset = (p.presets as { id?: string; inCollection?: boolean }[] | undefined)?.find((x) => x.inCollection && x.id && /^[A-Z]\d+$/.test(x.id));
    const pt = pointOf(f.geometry);
    if (!preset?.id || !pt) continue;
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

export function parseVegagerdin(raw: { Myndavel?: string; Skyring?: string; Vegheiti?: string; Slod?: string; Breidd?: number; Lengd?: number }[]): Row[] {
  const out: Row[] = [];
  const seen = new Set<string>();
  for (const c of raw ?? []) {
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

/** Trafikverket open API `Camera` objects (keyed; CC0). `PhotoTime` is the image time. */
export function parseTrafikverket(raw: TrafikverketResponse): Row[] {
  const out: Row[] = [];
  for (const c of raw.RESPONSE?.RESULT?.[0]?.Camera ?? []) {
    const m = c.Geometry?.WGS84?.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/);
    const photo = https(c.PhotoUrl);
    if (!c.Id || !/^[\w-]{1,60}$/.test(c.Id) || c.Active === false || !m || !photo) continue;
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
        stillUrl: c.HasFullSizePhoto ? `${photo}${photo.includes('?') ? '&' : '?'}type=fullsize` : photo,
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

export function parseHongKong(xml: string): Row[] {
  const out: Row[] = [];
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

/** LTA traffic images (data.gov.sg v1): each image URL is one snapshot with its own timestamp. */
export function parseLta(raw: LtaResponse): Row[] {
  const out: Row[] = [];
  for (const c of raw.items?.[0]?.cameras ?? []) {
    const lat = num(c.location?.latitude);
    const lng = num(c.location?.longitude);
    const still = https(c.image);
    if (!c.camera_id || !/^\d+$/.test(c.camera_id) || !still || !validLatLng(lat, lng)) continue;
    out.push(cam({ id: `lta-${c.camera_id}`, lat, lng: lng!, source: 'lta', providerId: 'lta', name: `LTA traffic camera ${c.camera_id}`, city: 'Singapore', country: 'SG', streamType: 'jpg', stillUrl: still, observedAt: isoWithOffset(c.timestamp) }));
  }
  return out;
}

/** Taiwan THB provincial highways: frames at `{html}/snapshot` on the cctv-ssNN encoders only. */
export function parseThb(raw: { id?: string; stakenumber?: string; gisx?: number; gisy?: number; html?: string }[]): Row[] {
  const out: Row[] = [];
  for (const c of raw ?? []) {
    const lat = num(c.gisy);
    const lng = num(c.gisx);
    const base = https(c.html);
    if (!c.id || !/^[\w-]+$/.test(c.id) || !base || !validLatLng(lat, lng)) continue;
    const u = new URL(base);
    if (!/^cctv-ss\d{2}\.thb\.gov\.tw$/.test(u.hostname)) continue;
    out.push(cam({ id: `thb-${c.id}`, lat, lng: lng!, source: 'thb', providerId: 'thb', name: text(c.stakenumber) || c.id, country: 'TW', streamType: 'jpg', stillUrl: `${u.origin}${u.pathname.replace(/\/$/, '')}/snapshot` }));
  }
  return out;
}

// ── Oceania ─────────────────────────────────────────────────────────────────────
/** NZTA `cameras/all` XML. Nested journey/leg/region/way blocks are removed before reading fields. */
export function parseNzta(xml: string): Row[] {
  const out: Row[] = [];
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

export function parseLiveTrafficNsw(raw: { id?: string; path?: string; eventType?: string; geometry?: { type?: string; coordinates?: unknown }; properties?: { title?: string; view?: string; href?: string; region?: string; direction?: string } }[]): Row[] {
  const out: Row[] = [];
  for (const f of raw ?? []) {
    if (f.eventType !== 'liveCams') continue;
    const pt = pointOf(f.geometry);
    const still = https(f.properties?.href);
    const key = f.path && /^[\w-]+$/.test(f.path) ? f.path : f.id;
    if (!pt || !still || !key) continue;
    out.push(
      cam({
        id: `nsw-${key}`,
        lat: pt[1],
        lng: pt[0],
        source: 'nsw',
        providerId: 'nsw',
        name: text(f.properties?.title) || key,
        city: text(f.properties?.region).replace(/_/g, ' ') || null,
        country: 'AU',
        streamType: 'jpg',
        stillUrl: still,
        externalUrl: null,
        headingDeg: headingOf(f.properties?.direction),
      }),
    );
  }
  return out;
}
