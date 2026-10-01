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

// Adapters validate every field they read, so the parsed JSON is handed over as `any`-shaped input.
async function getJson<T>(url: string, o: HttpOptions): Promise<T> {
  const r = await httpJson<T>(url, o);
  if (r.data === undefined) throw new HttpError('Empty body', 'parse', url);
  return r.data;
}

async function getText(url: string, o: HttpOptions): Promise<string> {
  const r = await httpText(url, o);
  if (r.text === undefined) throw new HttpError('Empty body', 'parse', url);
  return r.text;
}

const opts = (signal: AbortSignal, extra: HttpOptions = {}): HttpOptions => ({ signal, timeoutMs: 20_000, retries: 1, ...extra });

// Inventory politeness: lists are fetched at most every 30 min; the per-district fan-outs
// (Caltrans 12, TxDOT 25) are paced so an operator never sees a burst.
const caltransBucket = () => providerBucket('cctv-caltrans-list', 4, 4);
const txdotBucket = () => providerBucket('cctv-txdot-list', 4, 4);

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

export const INDOT_GRAPHQL_URL = 'https://511in.org/api/graphql';
/** Indiana's bounding box at the zoom where the map lists individual cameras. */
export const INDOT_QUERY = {
  query:
    'query MapFeatures($input: MapFeaturesArgs!) { mapFeaturesQuery(input: $input) { mapFeatures { uri title features { geometry } ... on Camera { active views(limit: 1) { category ... on CameraView { url } } } } } }',
  variables: { input: { north: 41.8, south: 37.7, east: -84.7, west: -88.2, zoom: 16, layerSlugs: ['normalCameras'] } },
} as const;

type In<F extends (raw: never, ...rest: never[]) => unknown> = Parameters<F>[0];

export const LOADERS: Record<string, Loader> = {
  caltrans: (signal) =>
    settledRows(
      Array.from({ length: 12 }, (_, i) => i + 1).map(async (d) => {
        const dd = String(d).padStart(2, '0');
        return A.parseCaltrans(await getJson<In<typeof A.parseCaltrans>>(`https://cwwp2.dot.ca.gov/data/d${d}/cctv/cctvStatusD${dd}.json`, opts(signal, { limiter: caltransBucket() })), d);
      }),
    ),
  wsdot: async (signal) => A.parseWsdotKml(await getText('https://wsdot.wa.gov/traffic/api/HighwayCameras/kml.aspx', opts(signal))),
  // A specific JSON Accept gets a 406 from TripCheck; the file is JSON served as JavaScript.
  odot: async (signal) => A.parseOdot(JSON.parse(await getText('https://www.tripcheck.com/Scripts/map/data/cctvinventory.js', opts(signal, { headers: { accept: '*/*' } })))),
  txdot: (signal) =>
    settledRows(
      A.TXDOT_DISTRICTS.map(async (d) =>
        A.parseTxdot(await getJson<In<typeof A.parseTxdot>>(`https://its.txdot.gov/its/DistrictIts/GetCctvStatusListByDistrict?districtCode=${d}`, opts(signal, { limiter: txdotBucket() })), d),
      ),
    ),
  mdot: async (signal) => A.parseMdot(await getJson<In<typeof A.parseMdot>>('https://mdotjboss.state.mi.us/MiDrive/camera/list', opts(signal))),
  // One statewide query (probed 2026-10-01: 748 features in ~1 s); the site's own map query.
  indot: async (signal) =>
    A.parseIndot(
      await getJson<In<typeof A.parseIndot>>(
        INDOT_GRAPHQL_URL,
        opts(signal, { method: 'POST', body: JSON.stringify(INDOT_QUERY), headers: { 'content-type': 'application/json' }, retries: 0 }),
      ),
    ),
  ottawa: async (signal) => A.parseOttawa(await getJson<In<typeof A.parseOttawa>>('https://traffic.ottawa.ca/beta/camera_list', opts(signal))),
  quebec: async (signal) =>
    A.parseQuebec(
      await getJson<In<typeof A.parseQuebec>>(
        'https://ws.mapserver.transports.gouv.qc.ca/swtq?service=wfs&version=2.0.0&request=getfeature&typename=ms:infos_cameras&outfile=Camera&srsname=EPSG:4326&outputformat=geojson',
        opts(signal),
      ),
    ),
  // Served as application/octet-stream.
  toronto: async (signal) =>
    A.parseToronto(
      JSON.parse(
        await getText('https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/a3309088-5fd4-4d34-8297-77c8301840ac/resource/4a568300-c7f8-496d-b150-dff6f5dc6d4f/download/traffic-camera-list-4326.geojson', opts(signal)),
      ),
    ),
  // Moved 2026: drivebc.ca/api/webcams → www.drivebc.ca/api/webcams/ (both old forms 301).
  drivebc: async (signal) => A.parseDriveBc(await getJson<In<typeof A.parseDriveBc>>('https://www.drivebc.ca/api/webcams/', opts(signal))),
  tfl: async (signal) => A.parseTfl(await getJson<In<typeof A.parseTfl>>(TFL_JAMCAM_URL, opts(signal, { headers: tflKeyHeaders() }))),
  dgt: async (signal) => A.parseDgt(await getJson<In<typeof A.parseDgt>>('https://www.dgt.es/.content/.assets/json/camaras.json', opts(signal))),
  // Moved 2026: /api/cameras → /api/cameras/ (301).
  rws: async (signal) => A.parseRws(await getJson<In<typeof A.parseRws>>('https://api.rwsverkeersinfo.nl/api/cameras/', opts(signal))),
  // Digitraffic asks every client to identify itself with a Digitraffic-User header.
  digitraffic: async (signal) =>
    A.parseDigitraffic(await getJson<In<typeof A.parseDigitraffic>>('https://tie.digitraffic.fi/api/weathercam/v1/stations', opts(signal, { headers: { 'digitraffic-user': 'GODSEYE' } }))),
  vegagerdin: async (signal) => A.parseVegagerdin(await getJson<In<typeof A.parseVegagerdin>>('https://gagnaveita.vegagerdin.is/api/vefmyndavelar2014_1', opts(signal))),
  trafikverket: async (signal) => {
    const key = (process.env.TRAFIKVERKET_KEY ?? '').replace(/[^\w-]/g, '');
    const body = `<REQUEST><LOGIN authenticationkey="${key}"/><QUERY objecttype="Camera" schemaversion="1" limit="5000"><FILTER><EQ name="Active" value="true"/></FILTER></QUERY></REQUEST>`;
    return A.parseTrafikverket(
      await getJson<In<typeof A.parseTrafikverket>>('https://api.trafikinfo.trafikverket.se/v2/data.json', opts(signal, { method: 'POST', body, headers: { 'content-type': 'text/xml' }, retries: 0 })),
    );
  },
  vialietuva: async (signal) => {
    const [layers, info] = await Promise.all([
      getJson<Parameters<typeof A.parseViaLietuva>[0]>('https://eismoinfo.lt/eismoinfo-backend/layer-static-features/VKR?lks=false', opts(signal)),
      getJson<Parameters<typeof A.parseViaLietuva>[1]>('https://eismoinfo.lt/eismoinfo-backend/camera-info-table', opts(signal)),
    ]);
    return A.parseViaLietuva(layers, info);
  },
  hktd: async (signal) => A.parseHongKong(await getText('https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_En.xml', opts(signal))),
  lta: async (signal) => A.parseLta(await getJson<In<typeof A.parseLta>>('https://api.data.gov.sg/v1/transport/traffic-images', opts(signal))),
  thb: async (signal) => A.parseThb(await getJson<In<typeof A.parseThb>>('https://thbapp.thb.gov.tw/services/cctv/thb', opts(signal))),
  nzta: async (signal) => A.parseNzta(await getText('https://trafficnz.info/service/traffic/rest/4/cameras/all', opts(signal))),
  nsw: async (signal) => A.parseLiveTrafficNsw(await getJson<In<typeof A.parseLiveTrafficNsw>>('https://www.livetraffic.com/datajson/all-feeds-web.json', opts(signal))),
};
