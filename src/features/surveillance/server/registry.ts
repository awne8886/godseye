/**
 * The camera provider registry (§5): every source is one row `{id, operator, list_endpoint,
 * frame_url_template, stream_type, licence, attribution_string, terms_url, key_required,
 * max_poll_interval, proxy_allowed, link_out_only}` shown in the viewer header and the attribution
 * panel, plus the exact-host + directory-prefix allow-list its stills are fetched through.
 *
 * Only official operator feeds with public terms are listed. Deliberately EXCLUDED (see
 * EXCLUDED_SOURCES and the test that enforces it): OpenCCTV's API (ToS + robots.txt forbid it),
 * Opentopia/Insecam-type directories of unsecured cameras, EarthCam and SkylineWebcams frames,
 * Windy images outside the keyed API, ASFINAG (needs embedded basic auth), Kolla Trafiken /
 * CamStreamer scraping, twipcam (bot check), Alberta/Ontario 511 (now "Invalid Key" without a
 * developer key), Montreal (URL retired, 301 to Québec 511 page), Taiwan Freeway Bureau MJPEG
 * (400 to non-browser clients). Probed 2026-09-30; see docs/data-sources/layers-surveillance.md.
 * Owner: layers-surveillance. Server-only.
 */
import 'server-only';
import type { CapabilityId } from '@/lib/capabilities';
import type { AllowRule } from '@/lib/ssrf';
import type { CameraProvider } from '@/lib/types';
import type { CctvRegion } from '../shared';

export interface ProviderDef {
  row: Omit<CameraProvider, 'link_out_only'> & { link_out_only: boolean };
  region: CctvRegion;
  /** Where stills (and, for status probes only, HLS playlists) may be fetched from. */
  rules: readonly AllowRule[];
  /** Keyed provider: runs only when this capability is on (else skippedProvider). */
  capability?: CapabilityId;
  /** IANA zone of timestamps the operator publishes without an offset (TxDOT snapshot times). */
  timeZone?: string;
}

const r = (host: string, pathPrefix: string): AllowRule => ({ host, pathPrefix });

const DISTRICTS = Array.from({ length: 12 }, (_, i) => i + 1);

export const PROVIDERS: readonly ProviderDef[] = [
  {
    region: 'us-west',
    row: {
      id: 'caltrans', operator: 'California Department of Transportation (Caltrans)', region: 'California', country: 'US',
      list_endpoint: 'https://cwwp2.dot.ca.gov/data/d{N}/cctv/cctvStatusD{NN}.json',
      frame_url_template: 'https://cwwp2.dot.ca.gov/data/d{N}/cctv/image/{camera}/{camera}.jpg',
      stream_type: 'jpg', licence: 'Public domain unless otherwise indicated (Caltrans Conditions of Use); CWWP2 data free of charge',
      attribution_string: 'Camera images and video: Caltrans CWWP2', terms_url: 'https://dot.ca.gov/conditions-of-use',
      key_required: false, max_poll_interval: 60, proxy_allowed: true, link_out_only: false,
    },
    rules: [...DISTRICTS.map((d) => r('cwwp2.dot.ca.gov', `/data/d${d}/cctv/image/`)), r('wzmedia.dot.ca.gov', '/')],
  },
  {
    region: 'us-west',
    row: {
      id: 'wsdot', operator: 'Washington State Department of Transportation (WSDOT)', region: 'Washington', country: 'US',
      list_endpoint: 'https://wsdot.wa.gov/traffic/api/HighwayCameras/kml.aspx', frame_url_template: 'https://images.wsdot.wa.gov/{path}.jpg',
      stream_type: 'jpg', licence: 'Public traveler information (no licence text published by WSDOT; credited)',
      attribution_string: 'Camera images: WSDOT', terms_url: 'https://wsdot.wa.gov/traffic/api/',
      key_required: false, max_poll_interval: 60, proxy_allowed: true, link_out_only: false,
    },
    rules: [r('images.wsdot.wa.gov', '/')],
  },
  {
    region: 'us-west',
    row: {
      id: 'odot', operator: 'Oregon Department of Transportation (TripCheck)', region: 'Oregon', country: 'US',
      list_endpoint: 'https://www.tripcheck.com/Scripts/map/data/cctvinventory.js', frame_url_template: 'https://tripcheck.com/RoadCams/cams/{filename}',
      stream_type: 'jpg', licence: 'TripCheck public road cameras (operator terms; not separately licensed)',
      attribution_string: 'Camera images: ODOT TripCheck.com', terms_url: 'https://www.tripcheck.com/',
      key_required: false, max_poll_interval: 60, proxy_allowed: true, link_out_only: false,
    },
    rules: [r('tripcheck.com', '/RoadCams/cams/'), r('www.tripcheck.com', '/RoadCams/cams/')],
  },
  {
    region: 'texas',
    timeZone: 'America/Chicago',
    row: {
      id: 'txdot', operator: 'Texas Department of Transportation (TxDOT ITS)', region: 'Texas', country: 'US',
      list_endpoint: 'https://its.txdot.gov/its/DistrictIts/GetCctvStatusListByDistrict?districtCode={DISTRICT}',
      frame_url_template: 'https://its.txdot.gov/its/DistrictIts/GetCctvSnapshotByIcdId?districtCode={DISTRICT}&icdId={ICD_ID}',
      stream_type: 'jpg', licence: 'No camera licence published (TxDOT website disclaimer); frames fetched live, never stored',
      attribution_string: 'Camera images: Texas Department of Transportation', terms_url: 'https://www.txdot.gov/about/disclaimer.html',
      key_required: false, max_poll_interval: 30, proxy_allowed: true, link_out_only: false,
    },
    rules: [r('its.txdot.gov', '/its/DistrictIts/GetCctvSnapshotByIcdId')],
  },
  {
    region: 'us-midwest',
    row: {
      id: 'mdot', operator: 'Michigan Department of Transportation (Mi Drive)', region: 'Michigan', country: 'US',
      list_endpoint: 'https://mdotjboss.state.mi.us/MiDrive/camera/list', frame_url_template: 'https://micamerasimages.net/thumbs/{camera}.flv.jpg',
      stream_type: 'jpg', licence: 'Mi Drive public traveler information (operator terms; not separately licensed)',
      attribution_string: 'Camera images: MDOT Mi Drive', terms_url: 'https://mdotjboss.state.mi.us/MiDrive/map',
      key_required: false, max_poll_interval: 60, proxy_allowed: true, link_out_only: false,
    },
    // Thumbnails 301 to the full frame at the host root; both hops are MDOT's camera image host.
    rules: [r('micamerasimages.net', '/')],
  },
  {
    region: 'canada',
    row: {
      id: 'ottawa', operator: 'City of Ottawa Traffic Operations', region: 'Ontario', country: 'CA',
      list_endpoint: 'https://traffic.ottawa.ca/beta/camera_list', frame_url_template: 'https://traffic.ottawa.ca/map/camera?id={number}',
      stream_type: 'jpg', licence: 'City of Ottawa public traffic cameras (operator terms; not separately licensed)',
      attribution_string: 'Traffic cameras: City of Ottawa', terms_url: 'https://traffic.ottawa.ca/',
      key_required: false, max_poll_interval: 60, proxy_allowed: true, link_out_only: false,
    },
    rules: [r('traffic.ottawa.ca', '/map/camera')],
  },
  {
    region: 'canada',
    row: {
      id: 'quebec', operator: 'Ministère des Transports et de la Mobilité durable du Québec (Québec 511)', region: 'Québec', country: 'CA',
      list_endpoint: 'https://ws.mapserver.transports.gouv.qc.ca/swtq?service=wfs&version=2.0.0&request=getfeature&typename=ms:infos_cameras&outputformat=geojson',
      frame_url_template: null, stream_type: 'link',
      licence: 'Québec 511 (operator terms); video pages refuse non-browser clients, so cameras link out to the operator',
      attribution_string: 'Cameras: Québec 511 — Transports et Mobilité durable Québec', terms_url: 'https://www.quebec511.info/',
      key_required: false, max_poll_interval: 60, proxy_allowed: false, link_out_only: true,
    },
    rules: [],
  },
  {
    region: 'canada',
    row: {
      id: 'toronto', operator: 'City of Toronto Transportation Services', region: 'Ontario', country: 'CA',
      list_endpoint: 'https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/a3309088-5fd4-4d34-8297-77c8301840ac/resource/4a568300-c7f8-496d-b150-dff6f5dc6d4f/download/traffic-camera-list-4326.geojson',
      frame_url_template: 'https://opendata.toronto.ca/transportation/tmc/rescucameraimages/CameraImages/loc{REC_ID}.jpg',
      stream_type: 'jpg', licence: 'Open Government Licence – Toronto',
      attribution_string: 'Contains information licensed under the Open Government Licence – Toronto', terms_url: 'https://open.toronto.ca/open-data-license/',
      key_required: false, max_poll_interval: 60, proxy_allowed: true, link_out_only: false,
    },
    rules: [r('opendata.toronto.ca', '/transportation/tmc/rescucameraimages/CameraImages/')],
  },
  {
    region: 'canada',
    row: {
      id: 'drivebc', operator: 'BC Ministry of Transportation and Transit (DriveBC)', region: 'British Columbia', country: 'CA',
      list_endpoint: 'https://www.drivebc.ca/api/webcams/', frame_url_template: 'https://www.drivebc.ca/images/{id}.jpg',
      stream_type: 'jpg', licence: 'DriveBC public webcams (operator terms; not separately licensed)',
      attribution_string: 'Webcam images: DriveBC.ca', terms_url: 'https://www.drivebc.ca/',
      key_required: false, max_poll_interval: 60, proxy_allowed: true, link_out_only: false,
    },
    rules: [r('www.drivebc.ca', '/images/')],
  },
  {
    region: 'uk',
    capability: 'tfl',
    row: {
      id: 'tfl', operator: 'Transport for London (JamCams)', region: 'London', country: 'GB',
      list_endpoint: 'https://api.tfl.gov.uk/Place/Type/JamCam', frame_url_template: 'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/{id}.jpg',
      stream_type: 'mp4', licence: 'TfL Open Data (Transport Data Service terms, modified OGL); registered app_key',
      attribution_string: 'Powered by TfL Open Data. Contains OS data © Crown copyright and database rights',
      terms_url: 'https://tfl.gov.uk/corporate/terms-and-conditions/transport-data-service',
      key_required: true, max_poll_interval: 60, proxy_allowed: true, link_out_only: false,
    },
    rules: [r('s3-eu-west-1.amazonaws.com', '/jamcams.tfl.gov.uk/')],
  },
  {
    region: 'europe',
    row: {
      id: 'dgt', operator: 'Dirección General de Tráfico (DGT)', region: 'Spain', country: 'ES',
      list_endpoint: 'https://www.dgt.es/.content/.assets/json/camaras.json', frame_url_template: 'https://etraffic.dgt.es/camarasEtraffic/{id}.jpg',
      stream_type: 'jpg', licence: 'Spanish public-sector information reuse with attribution (DGT terms not verified per camera)',
      attribution_string: 'Camera images: DGT — Dirección General de Tráfico', terms_url: 'https://www.dgt.es/',
      key_required: false, max_poll_interval: 120, proxy_allowed: true, link_out_only: false,
    },
    rules: [r('etraffic.dgt.es', '/camarasEtraffic/')],
  },
  {
    region: 'europe',
    row: {
      id: 'rws', operator: 'Rijkswaterstaat (camera streams by INMOVES)', region: 'Netherlands', country: 'NL',
      list_endpoint: 'https://api.rwsverkeersinfo.nl/api/cameras/', frame_url_template: null, stream_type: 'link',
      licence: 'Operator terms (not verified); frames require a browser Referer, so cameras link out to the operator player',
      attribution_string: 'Cameras: Rijkswaterstaat / INMOVES', terms_url: 'https://www.rwsverkeersinfo.nl/',
      key_required: false, max_poll_interval: 60, proxy_allowed: false, link_out_only: true,
    },
    rules: [],
  },
  {
    region: 'nordics',
    row: {
      id: 'digitraffic', operator: 'Fintraffic (Digitraffic road weather cameras)', region: 'Finland', country: 'FI',
      list_endpoint: 'https://tie.digitraffic.fi/api/weathercam/v1/stations', frame_url_template: 'https://weathercam.digitraffic.fi/{presetId}.jpg',
      stream_type: 'jpg', licence: 'CC BY 4.0', attribution_string: 'Source: Fintraffic / digitraffic.fi, license CC 4.0 BY',
      terms_url: 'https://www.digitraffic.fi/en/terms-of-service/', key_required: false, max_poll_interval: 60, proxy_allowed: true, link_out_only: false,
    },
    rules: [r('weathercam.digitraffic.fi', '/')],
  },
  {
    region: 'nordics',
    row: {
      id: 'vegagerdin', operator: 'Vegagerðin (Icelandic Road and Coastal Administration)', region: 'Iceland', country: 'IS',
      list_endpoint: 'https://gagnaveita.vegagerdin.is/api/vefmyndavelar2014_1', frame_url_template: 'https://www.vegagerdin.is/vgdata/vefmyndavelar/{name}.jpg',
      stream_type: 'jpg', licence: 'Vegagerðin open data service (operator terms; not separately licensed)',
      attribution_string: 'Road cameras: Vegagerðin', terms_url: 'https://www.vegagerdin.is/',
      key_required: false, max_poll_interval: 60, proxy_allowed: true, link_out_only: false,
    },
    rules: [r('www.vegagerdin.is', '/vgdata/vefmyndavelar/')],
  },
  {
    region: 'nordics',
    capability: 'trafikverket',
    row: {
      id: 'trafikverket', operator: 'Trafikverket (Swedish Transport Administration)', region: 'Sweden', country: 'SE',
      list_endpoint: 'https://api.trafikinfo.trafikverket.se/v2/data.json', frame_url_template: 'https://api.trafikinfo.trafikverket.se/v2/Images/data/road.infrastructure.camera/{id}.jpg',
      stream_type: 'jpg', licence: 'CC0 1.0 (Trafikverket open API; registered key)', attribution_string: 'Camera images: Trafikverket (CC0)',
      terms_url: 'https://www.trafikverket.se/e-tjanster/trafikverkets-oppna-api-for-trafikinformation/',
      key_required: true, max_poll_interval: 60, proxy_allowed: true, link_out_only: false,
    },
    rules: [r('api.trafikinfo.trafikverket.se', '/v2/Images/data/road.infrastructure.camera/')],
  },
  {
    region: 'asia',
    row: {
      id: 'hktd', operator: 'Transport Department, HKSAR Government', region: 'Hong Kong', country: 'HK',
      list_endpoint: 'https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_En.xml', frame_url_template: 'https://tdcctv.data.one.gov.hk/{key}.JPG',
      stream_type: 'jpg', licence: 'DATA.GOV.HK Terms and Conditions (commercial and non-commercial reuse with attribution)',
      attribution_string: 'Traffic snapshots: Transport Department, HKSAR Government, via DATA.GOV.HK', terms_url: 'https://data.gov.hk/en/terms-and-conditions',
      key_required: false, max_poll_interval: 60, proxy_allowed: true, link_out_only: false,
    },
    rules: [r('tdcctv.data.one.gov.hk', '/')],
  },
  {
    region: 'asia',
    row: {
      id: 'lta', operator: 'Land Transport Authority, Singapore (data.gov.sg)', region: 'Singapore', country: 'SG',
      list_endpoint: 'https://api.data.gov.sg/v1/transport/traffic-images', frame_url_template: 'https://images.data.gov.sg/api/traffic-images/{yyyy}/{mm}/{uuid}.jpg',
      stream_type: 'jpg', licence: 'Singapore Open Data Licence v1.0',
      attribution_string: 'Contains information from Traffic Images accessed from data.gov.sg, made available under the Singapore Open Data Licence v1.0',
      terms_url: 'https://data.gov.sg/open-data-licence', key_required: false, max_poll_interval: 60, proxy_allowed: true, link_out_only: false,
    },
    rules: [r('images.data.gov.sg', '/api/traffic-images/')],
  },
  {
    region: 'asia',
    row: {
      id: 'thb', operator: 'Directorate General of Highways, MOTC (Taiwan)', region: 'Taiwan', country: 'TW',
      list_endpoint: 'https://thbapp.thb.gov.tw/services/cctv/thb', frame_url_template: 'https://cctv-ssNN.thb.gov.tw/{stake}/snapshot',
      stream_type: 'jpg', licence: 'Open Government Data License, version 1.0 (Taiwan)',
      attribution_string: 'Directorate General of Highways, MOTC (2026), Open Government Data License v1.0 — https://data.gov.tw/license',
      terms_url: 'https://data.gov.tw/license', key_required: false, max_poll_interval: 60, proxy_allowed: true, link_out_only: false,
    },
    rules: Array.from({ length: 8 }, (_, i) => r(`cctv-ss0${i + 1}.thb.gov.tw`, '/')),
  },
  {
    region: 'oceania',
    row: {
      id: 'nzta', operator: 'NZ Transport Agency Waka Kotahi', region: 'New Zealand', country: 'NZ',
      list_endpoint: 'https://trafficnz.info/service/traffic/rest/4/cameras/all', frame_url_template: 'https://trafficnz.info/camera/{id}.jpg',
      stream_type: 'jpg', licence: 'NZTA traffic information (operator terms; not separately licensed)',
      attribution_string: 'Traffic cameras: NZ Transport Agency Waka Kotahi (trafficnz.info)', terms_url: 'https://trafficnz.info/',
      key_required: false, max_poll_interval: 60, proxy_allowed: true, link_out_only: false,
    },
    rules: [r('trafficnz.info', '/camera/')],
  },
  {
    region: 'oceania',
    row: {
      id: 'nsw', operator: 'Transport for NSW (Live Traffic NSW)', region: 'New South Wales', country: 'AU',
      list_endpoint: 'https://www.livetraffic.com/datajson/all-feeds-web.json', frame_url_template: 'https://webcams.transport.nsw.gov.au/livetraffic-webcams/cameras/{name}.jpeg',
      stream_type: 'jpg', licence: 'Live Traffic NSW public webcams (operator terms; not separately licensed)',
      attribution_string: 'Traffic cameras: Transport for NSW (Live Traffic NSW)', terms_url: 'https://www.livetraffic.com/',
      key_required: false, max_poll_interval: 60, proxy_allowed: true, link_out_only: false,
    },
    rules: [r('webcams.transport.nsw.gov.au', '/livetraffic-webcams/cameras/')],
  },
];

/**
 * Sources that must never appear in the registry (policy, §5). The test suite asserts no
 * list endpoint, frame template or allow-list rule touches these hosts.
 */
export const EXCLUDED_SOURCES: readonly { host: string; reason: string }[] = [
  { host: 'opencctv.org', reason: 'OpenCCTV ToS forbid scraping; robots.txt disallows /api/' },
  { host: 'images.opentopia.com', reason: 'Opentopia lists unsecured private cameras (Insecam-type)' },
  { host: 'insecam.org', reason: 'Insecam lists cameras with default passwords' },
  { host: 'earthcam.com', reason: 'EarthCam frames/streams: link out or official embeds only' },
  { host: 'skylinewebcams.com', reason: 'SkylineWebcams ToS forbid reproducing frames' },
  { host: 'imgproxy.windy.com', reason: 'Windy images only via the keyed API' },
  { host: 'odo.asfinag.at', reason: 'ASFINAG endpoint needs embedded basic-auth credentials' },
  { host: 'kollatrafiken.se', reason: 'Third-party scraping; Trafikverket official API used instead' },
  { host: 'camstreamer.com', reason: 'Player scraping' },
  { host: 'twipcam.com', reason: 'Bot-check protected; scraping not allowed' },
  { host: 'bekijkhet.nu', reason: 'Discovery index only (no feeds, no licence)' },
];

/**
 * Region-level link-out-only switch (§0.7): `CCTV_LINK_OUT_ONLY` is a comma list of region keys
 * (`uk,europe`) and/or ISO country codes (`GB,NL`). Matching providers publish no frames or
 * streams; their cameras open the operator's own page instead.
 */
export function linkOutSet(env: Record<string, string | undefined> = process.env): Set<string> {
  return new Set((env.CCTV_LINK_OUT_ONLY ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
}

export function providerRow(def: ProviderDef, env: Record<string, string | undefined> = process.env): CameraProvider {
  const set = linkOutSet(env);
  const forced = set.has(def.region) || set.has(def.row.country.toLowerCase());
  return { ...def.row, link_out_only: def.row.link_out_only || forced, proxy_allowed: def.row.proxy_allowed && !forced };
}

/**
 * Cameras withdrawn after a confirmed removal request (§0.7), plus any ids an instance operator
 * lists in `CCTV_REMOVED_IDS` (comma-separated). Removed cameras never enter the catalogue.
 */
export const REMOVED_CAMERA_IDS: ReadonlySet<string> = new Set<string>([]);

export function isRemoved(id: string, env: Record<string, string | undefined> = process.env): boolean {
  if (REMOVED_CAMERA_IDS.has(id)) return true;
  const extra = env.CCTV_REMOVED_IDS;
  return !!extra && extra.split(',').some((s) => s.trim() === id);
}

const BY_ID = new Map(PROVIDERS.map((p) => [p.row.id, p]));

export function providerDef(id: string): ProviderDef | null {
  return BY_ID.get(id) ?? null;
}

export function providersIn(region: CctvRegion): ProviderDef[] {
  return PROVIDERS.filter((p) => p.region === region);
}
