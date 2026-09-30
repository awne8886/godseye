/**
 * Recorded upstream responses for the space tests (captured 2026-09-30T18:05Z from the probes in
 * docs/data-sources/layers-space.md; each JSON file carries `capturedAt`, `source` and a trimming
 * note). Test-only: never imported by shipped code.
 */
import active from './celestrak-active-sample.json';
import stations from './celestrak-stations.json';
import satnogs from './satnogs-tle-sample.json';
import kp from './swpc-kp.json';
import mag from './swpc-rtsw-mag.json';
import wind from './swpc-rtsw-wind.json';
import xrays from './swpc-xrays-6h.json';
import scales from './swpc-scales.json';
import alerts from './swpc-alerts.json';
import iss from './wheretheiss.json';

export const FIXTURE_CAPTURED_AT = Date.parse('2026-09-30T18:05:00Z');

export const fx = {
  active: active.data as unknown as Record<string, unknown>[],
  stations: stations.data as unknown as Record<string, unknown>[],
  satnogs: satnogs.data as unknown as Record<string, unknown>[],
  kp: kp.data as unknown,
  mag: mag.data as unknown,
  wind: wind.data as unknown,
  xrays: xrays.data as unknown,
  scales: scales.data as unknown,
  alerts: alerts.data as unknown,
  iss: iss.data as unknown,
};
