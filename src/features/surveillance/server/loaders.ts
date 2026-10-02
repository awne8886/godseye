/**
 * Upstream camera-list loaders, one per registry row. Every call goes through httpJson/httpText
 * (honest UA, deadline, retries) and hands the body to a pure adapter. URL changes found in the
 * 2026-09-30 probes are encoded here (DriveBC and RWS moved behind 301s; TxDOT's new response shape
 * is handled in the adapter). Owner: layers-surveillance. Server-only.
 */
import 'server-only';
import { HttpError, httpJson, httpText, type HttpOptions } from '@/lib/http';
import { providerBucket } from '@/lib/ratelimit';
import type { Camera } from '@/lib/types';
import * as A from './adapters';

export type Loader = (signal: AbortSignal) => Promise<Camera[]>;

/** The top-level JSON shape an operator's camera list must have. */
export type BodyShape = 'array' | 'object';

/** Kind of a parsed JSON value, for the shape check and its error message (never the value itself). */
export function jsonKind(v: unknown): 'null' | 'array' | 'object' | 'string' | 'number' | 'boolean' | 'undefined' {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  const t = typeof v;
  return t === 'object' || t === 'string' || t === 'number' || t === 'boolean' ? t : 'undefined';
}

/**
 * Refuse a list body of the wrong top-level shape (`null`, a string, an object where an array is
 * expected…) as `parse`: the provider reads SOURCE OFFLINE and keeps its last good rows, rather
 * than reporting "0 cameras" as if the operator had none.
 */
export function expectShape<T = unknown>(data: unknown, shape: BodyShape, url: string): T {
  const kind = jsonKind(data);
  if (kind !== shape) throw new HttpError(`Unexpected body: ${kind}, expected ${shape}`, 'parse', url);
  return data as T;
}

/** JSON served under another content type (ODOT as JavaScript, Toronto as octet-stream). */
export function parseJsonText(text: string, url: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError('Body is not JSON', 'parse', url);
  }
}

// Adapters validate every field they read; the loader checks the top-level shape first.
async function getJson(url: string, o: HttpOptions, shape: BodyShape): Promise<unknown> {
  const r = await httpJson<unknown>(url, o);
  if (r.data === undefined) throw new HttpError('Empty body', 'parse', url);
  return expectShape(r.data, shape, url);
}

async function getText(url: string, o: HttpOptions): Promise<string> {
  const r = await httpText(url, o);
  if (typeof r.text !== 'string') throw new HttpError('Empty body', 'parse', url);
  return r.text;
}

async function getJsonText(url: string, o: HttpOptions, shape: BodyShape): Promise<unknown> {
  return expectShape(parseJsonText(await getText(url, o), url), shape, url);
}

const opts = (signal: AbortSignal, extra: HttpOptions = {}): HttpOptions => ({ signal, timeoutMs: 20_000, retries: 1, ...extra });

// Inventory politeness: lists are fetched at most every 30 min; the per-district fan-outs
// (Caltrans 12, TxDOT 25) are paced so an operator never sees a burst.
const caltransBucket = () => providerBucket('cctv-caltrans-list', 4, 4);
const txdotBucket = () => providerBucket('cctv-txdot-list', 4, 4);
const mlitBucket = () => providerBucket('cctv-mlit-list', 3, 3);

/** Rows from every district that answered; throws only when none did. */
export async function settledRows(jobs: Promise<Camera[]>[]): Promise<Camera[]> {
  const res = await Promise.allSettled(jobs);
  const ok = res.filter((r): r is PromiseFulfilledResult<Camera[]> => r.status === 'fulfilled');
  if (!ok.length) throw (res[0] as PromiseRejectedResult | undefined)?.reason ?? new Error('no districts answered');
  return ok.flatMap((r) => r.value);
}

export const TFL_JAMCAM_URL = 'https://api.tfl.gov.uk/Place/Type/JamCam';

/**
 * TfL's Unified API reads `app_key` from a request header as well as the query string (probed
 * 2026-09-30: a bogus key in the header is rejected with "Invalid app_key", so the header is
 * honoured). The key therefore never appears in a URL, an HttpError or a log line; http.ts drops
 * the header on any cross-origin redirect.
 */
export function tflKeyHeaders(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const key = (env.TFL_APP_KEY ?? '').trim().replace(/[^\w-]/g, '');
  return key ? { app_key: key } : {};
}

export const EDMONTON_CAMERAS_URL = 'https://edmontontrafficcam.com/Default.aspx/GetCameras';

export const MLIT_PREFS_URL = 'https://www.river.go.jp/kawabou/file/files/map/pref/prefarea.json';
export const mlitMasterUrl = (prefCd: string) => `https://www.river.go.jp/kawabou/file/gjson/scam/${prefCd}.json`;

export const INDOT_GRAPHQL_URL = 'https://511in.org/api/graphql';
/** Indiana's bounding box at the zoom where the map lists individual cameras. */
export const INDOT_QUERY = {
  query:
    'query MapFeatures($input: MapFeaturesArgs!) { mapFeaturesQuery(input: $input) { mapFeatures { uri title features { geometry } ... on Camera { active views(limit: 1) { category ... on CameraView { url } } } } } }',
  variables: { input: { north: 41.8, south: 37.7, east: -84.7, west: -88.2, zoom: 16, layerSlugs: ['normalCameras'] } },
} as const;

/**
 * The top-level JSON shape of each operator's camera list (checked against the recorded fixtures in
 * loaders.test.ts). A body of any other shape is refused as `parse` before the adapter runs.
 */
export const LIST_SHAPES = {
  caltrans: 'object',
  odot: 'object',
  txdot: 'object',
  mdot: 'array',
  indot: 'object',
  ottawa: 'array',
  quebec: 'object',
  edmonton: 'object',
  toronto: 'object',
  drivebc: 'array',
  tfl: 'array',
  dgt: 'object',
  rws: 'array',
  digitraffic: 'object',
  vegagerdin: 'array',
  trafikverket: 'object',
  vialietuvaLayers: 'array',
  vialietuvaInfo: 'array',
  lta: 'object',
  thb: 'array',
  mlitPrefs: 'object',
  mlit: 'object',
  nsw: 'array',
} as const satisfies Record<string, BodyShape>;

export const LOADERS: Record<string, Loader> = {
  caltrans: (signal) =>
    settledRows(
      Array.from({ length: 12 }, (_, i) => i + 1).map(async (d) => {
        const dd = String(d).padStart(2, '0');
        return A.parseCaltrans(await getJson(`https://cwwp2.dot.ca.gov/data/d${d}/cctv/cctvStatusD${dd}.json`, opts(signal, { limiter: caltransBucket() }), LIST_SHAPES.caltrans), d);
      }),
    ),
  wsdot: async (signal) => A.parseWsdotKml(await getText('https://wsdot.wa.gov/traffic/api/HighwayCameras/kml.aspx', opts(signal))),
  // A specific JSON Accept gets a 406 from TripCheck; the file is JSON served as JavaScript.
  odot: async (signal) => A.parseOdot(await getJsonText('https://www.tripcheck.com/Scripts/map/data/cctvinventory.js', opts(signal, { headers: { accept: '*/*' } }), LIST_SHAPES.odot)),
  txdot: (signal) =>
    settledRows(
      A.TXDOT_DISTRICTS.map(async (d) => A.parseTxdot(await getJson(`https://its.txdot.gov/its/DistrictIts/GetCctvStatusListByDistrict?districtCode=${d}`, opts(signal, { limiter: txdotBucket() }), LIST_SHAPES.txdot), d)),
    ),
  mdot: async (signal) => A.parseMdot(await getJson('https://mdotjboss.state.mi.us/MiDrive/camera/list', opts(signal), LIST_SHAPES.mdot)),
  // One statewide query (probed 2026-10-01: 748 features in ~1 s); the site's own map query.
  indot: async (signal) =>
    A.parseIndot(await getJson(INDOT_GRAPHQL_URL, opts(signal, { method: 'POST', body: JSON.stringify(INDOT_QUERY), headers: { 'content-type': 'application/json' }, retries: 0 }), LIST_SHAPES.indot)),
  ottawa: async (signal) => A.parseOttawa(await getJson('https://traffic.ottawa.ca/beta/camera_list', opts(signal), LIST_SHAPES.ottawa)),
  quebec: async (signal) =>
    A.parseQuebec(
      await getJson(
        'https://ws.mapserver.transports.gouv.qc.ca/swtq?service=wfs&version=2.0.0&request=getfeature&typename=ms:infos_cameras&outfile=Camera&srsname=EPSG:4326&outputformat=geojson',
        opts(signal),
        LIST_SHAPES.quebec,
      ),
    ),
  // ASP.NET page method: POST `{}` (probed 2026-10-02: 58 cameras in ~0.8 s). Behind nc_sources.
  edmonton: async (signal) =>
    A.parseEdmonton(await getJson(EDMONTON_CAMERAS_URL, opts(signal, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json; charset=utf-8' }, retries: 0 }), LIST_SHAPES.edmonton)),
  // Served as application/octet-stream.
  toronto: async (signal) =>
    A.parseToronto(
      await getJsonText(
        'https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/a3309088-5fd4-4d34-8297-77c8301840ac/resource/4a568300-c7f8-496d-b150-dff6f5dc6d4f/download/traffic-camera-list-4326.geojson',
        opts(signal),
        LIST_SHAPES.toronto,
      ),
    ),
  // Moved 2026: drivebc.ca/api/webcams → www.drivebc.ca/api/webcams/ (both old forms 301).
  drivebc: async (signal) => A.parseDriveBc(await getJson('https://www.drivebc.ca/api/webcams/', opts(signal), LIST_SHAPES.drivebc)),
  tfl: async (signal) => A.parseTfl(await getJson(TFL_JAMCAM_URL, opts(signal, { headers: tflKeyHeaders() }), LIST_SHAPES.tfl)),
  dgt: async (signal) => A.parseDgt(await getJson('https://www.dgt.es/.content/.assets/json/camaras.json', opts(signal), LIST_SHAPES.dgt)),
  // Moved 2026: /api/cameras → /api/cameras/ (301).
  rws: async (signal) => A.parseRws(await getJson('https://api.rwsverkeersinfo.nl/api/cameras/', opts(signal), LIST_SHAPES.rws)),
  // Digitraffic asks every client to identify itself with a Digitraffic-User header.
  digitraffic: async (signal) => A.parseDigitraffic(await getJson('https://tie.digitraffic.fi/api/weathercam/v1/stations', opts(signal, { headers: { 'digitraffic-user': 'GODSEYE' } }), LIST_SHAPES.digitraffic)),
  vegagerdin: async (signal) => A.parseVegagerdin(await getJson('https://gagnaveita.vegagerdin.is/api/vefmyndavelar2014_1', opts(signal), LIST_SHAPES.vegagerdin)),
  trafikverket: async (signal) => {
    const key = (process.env.TRAFIKVERKET_KEY ?? '').replace(/[^\w-]/g, '');
    const body = `<REQUEST><LOGIN authenticationkey="${key}"/><QUERY objecttype="Camera" schemaversion="1" limit="5000"><FILTER><EQ name="Active" value="true"/></FILTER></QUERY></REQUEST>`;
    return A.parseTrafikverket(await getJson('https://api.trafikinfo.trafikverket.se/v2/data.json', opts(signal, { method: 'POST', body, headers: { 'content-type': 'text/xml' }, retries: 0 }), LIST_SHAPES.trafikverket));
  },
  vialietuva: async (signal) => {
    const [layers, info] = await Promise.all([
      getJson('https://eismoinfo.lt/eismoinfo-backend/layer-static-features/VKR?lks=false', opts(signal), LIST_SHAPES.vialietuvaLayers),
      getJson('https://eismoinfo.lt/eismoinfo-backend/camera-info-table', opts(signal), LIST_SHAPES.vialietuvaInfo),
    ]);
    return A.parseViaLietuva(layers, info);
  },
  hktd: async (signal) => A.parseHongKong(await getText('https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_En.xml', opts(signal))),
  lta: async (signal) => A.parseLta(await getJson('https://api.data.gov.sg/v1/transport/traffic-images', opts(signal), LIST_SHAPES.lta)),
  thb: async (signal) => A.parseThb(await getJson('https://thbapp.thb.gov.tw/services/cctv/thb', opts(signal), LIST_SHAPES.thb)),
  // The area list, then one camera master per area (51 codes, 49 files; codes 101 and 4701 answer
  // 404 = no cameras), paced at 3/s. Probed 2026-10-02: 3.3 MB, ~1 s per file.
  mlit: async (signal) => {
    const codes = A.parseMlitPrefCodes(await getJson(MLIT_PREFS_URL, opts(signal), LIST_SHAPES.mlitPrefs));
    if (!codes.length) throw new HttpError('No area codes in prefarea.json', 'parse', MLIT_PREFS_URL);
    return settledRows(codes.map(async (c) => A.parseMlit(await getJson(mlitMasterUrl(c), opts(signal, { limiter: mlitBucket(), retries: 0 }), LIST_SHAPES.mlit))));
  },
  nzta: async (signal) => A.parseNzta(await getText('https://trafficnz.info/service/traffic/rest/4/cameras/all', opts(signal))),
  nsw: async (signal) => A.parseLiveTrafficNsw(await getJson('https://www.livetraffic.com/datajson/all-feeds-web.json', opts(signal), LIST_SHAPES.nsw)),
};

