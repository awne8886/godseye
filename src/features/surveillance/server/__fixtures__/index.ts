/**
 * Recorded upstream fixtures for the surveillance adapters, trimmed from real probes captured
 * 2026-09-30 (see docs/data-sources/layers-surveillance.md). Tests only.
 */
import { readFileSync } from 'node:fs';

const at = (name: string) => new URL(`./${name}`, import.meta.url);
const D = '2026-09-30';

export const text = (name: string): string => readFileSync(at(name), 'utf8');
export const json = <T = unknown>(name: string): T => JSON.parse(text(name)) as T;

export const FX = {
  caltrans: `caltrans-d7.${D}.json`,
  wsdot: `wsdot-cameras.${D}.kml`,
  odot: `odot-cctvinventory.${D}.js`,
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
  ytLive: `yt-aljazeera-live.${D}.html`,
  ytChannel: `yt-cspan-live.${D}.html`,
  ytUnknown: `yt-cbc-live.${D}.html`,
} as const;
