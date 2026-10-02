/**
 * Recorded upstream fixtures for the surveillance adapters, trimmed from real probes captured
 * 2026-09-30 (see docs/data-sources/layers-surveillance.md). Tests only.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const at = (name: string) => new URL(`./${name}`, import.meta.url);
const D = '2026-09-30';

export const text = (name: string): string => readFileSync(at(name), 'utf8');
export const json = <T = unknown>(name: string): T => JSON.parse(text(name)) as T;

export const FX = {
  caltrans: `caltrans-d7.${D}.json`,
  wsdot: `wsdot-cameras.${D}.kml`,
  odot: `odot-cctvinventory.${D}.json`,
  txdot: `txdot-aus.${D}.json`,
  txdotSnapshot: `txdot-snapshot.${D}.json`,
  /**
   * The exact body TxDOT answered (`200 application/json; charset=utf-8`, 4 bytes `null`) for a listed
   * camera without a current snapshot: YKM "YKM-US59 @ Youngdale Rd (S)- El Campo", probed 2026-10-01T17:34Z.
   */
  txdotSnapshotNull: 'txdot-snapshot-null.2026-10-01.json',
  mdot: `mdot-list.${D}.json`,
  ottawa: `ottawa-camera-list.${D}.json`,
  quebec: `quebec-wfs.${D}.json`,
  toronto: `toronto-cameras.${D}.json`,
  drivebc: `drivebc-webcams.${D}.json`,
  tfl: `tfl-jamcam.${D}.json`,
  dgt: `dgt-camaras.${D}.json`,
  rws: `rws-cameras.${D}.json`,
  digitraffic: `digitraffic-stations.${D}.json`,
  vegagerdin: `vegagerdin.${D}.json`,
  hktd: `hk-td-locations.${D}.xml`,
  lta: `lta-traffic-images.${D}.json`,
  thb: `thb-cctv.${D}.json`,
  nzta: `nzta-cameras.${D}.xml`,
  nsw: `livetraffic-feeds.${D}.json`,
  indot: 'indot-graphql.2026-10-01.json',
  vialietuvaVkr: 'vialietuva-vkr.2026-10-01.json',
  vialietuvaInfo: 'vialietuva-info.2026-10-01.json',
  /** The first six cameras of City of Edmonton `POST Default.aspx/GetCameras` (58, all Online), probed 2026-10-02T00:32Z. */
  edmonton: 'edmonton-getcameras.2026-10-02.json',
  /** MLIT river.go.jp area list (`prefs[]`, 51 codes), probed 2026-10-02. */
  mlitPrefs: 'mlit-prefarea.2026-10-02.json',
  /** Tokyo (1301) camera master trimmed to two cameras per `sys_id` (1, 2, 3), probed 2026-10-02T00:36Z. */
  mlit: 'mlit-scam-1301.2026-10-02.json',
  /** One paused (`pause: 1`) camera from the Hokkaido area 102 master, probed 2026-10-02. */
  mlitPaused: 'mlit-scam-paused.2026-10-02.json',
  catalogueStills: 'catalogue-stills.2026-10-01.json.gz',
  /** Still response headers per provider (HK TD, Caltrans, Digitraffic, NSW, Ottawa, THB, Via Lietuva, Toronto). */
  frameHeaders: 'frame-headers.2026-10-01.json',
  /** The 307-byte text/html page NSW served for every `.jpeg` still (2026-09-30 → 10-01). */
  nswHtmlFrame: 'nsw-frame-unavailable.2026-10-01.html',
  /** The first six `liveCams` features of the NSW Live Traffic feed (241 cameras), probed 2026-10-01T10:35Z. */
  nswLiveCams: 'livetraffic-livecams.2026-10-01.json',
  ytLive: `yt-aljazeera-live.${D}.html`,
  ytChannel: `yt-cspan-live.${D}.html`,
  ytUnknown: `yt-cbc-live.${D}.html`,
} as const;

/**
 * Every still URL the keyless adapters produced from the full upstream lists recorded 2026-10-01
 * (provider id → URLs; Caltrans D4 + D7, TxDOT AUS, all other providers complete; MLIT from all 49
 * area masters recorded 2026-10-02), gzipped.
 */
export const catalogueStills = (): Record<string, string[]> => JSON.parse(gunzipSync(readFileSync(at(FX.catalogueStills))).toString('utf8')) as Record<string, string[]>;
