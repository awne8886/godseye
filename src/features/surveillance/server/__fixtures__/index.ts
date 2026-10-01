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
  catalogueStills: 'catalogue-stills.2026-10-01.json.gz',
  ytLive: `yt-aljazeera-live.${D}.html`,
  ytChannel: `yt-cspan-live.${D}.html`,
  ytUnknown: `yt-cbc-live.${D}.html`,
} as const;

/**
 * Every still URL the keyless adapters produced from the full upstream lists recorded 2026-10-01
 * (provider id → URLs; Caltrans D4 + D7, TxDOT AUS, all other providers complete), gzipped.
 */
export const catalogueStills = (): Record<string, string[]> => JSON.parse(gunzipSync(readFileSync(at(FX.catalogueStills))).toString('utf8')) as Record<string, string[]>;
