/**
 * Server-side feeds for space. Owner: layers-space. Server-only.
 * List every Feed defined with defineFeed() in this area so instrumentation can start the eager
 * ones and /api/health reports them before their first request.
 */
import 'server-only';
import { defineFeed, type Feed } from '@/lib/feeds';
import { runSatellites, type SatCatalogue } from './server/satellites';
import { runSpaceWeather, type SpaceWeatherData } from './server/space-weather';
import { runIss, type IssPosition } from './server/iss';

const MIN = 60_000;

export const satellitesFeed = defineFeed<SatCatalogue>({
  key: 'satellites',
  // CelesTrak updates every 2 h and allows one `active` download per update.
  ttlMs: 120 * MIN,
  kind: 'live',
  attribution: [
    { text: 'Orbital elements: CelesTrak GP (OMM), Dr T.S. Kelso', url: 'https://celestrak.org/NORAD/documentation/gp-data-formats.php' },
    { text: 'Fallback TLEs: SatNOGS DB (Libre Space Foundation)', url: 'https://db.satnogs.org/', licence: 'CC BY-SA 4.0' },
  ],
  note: 'Positions are propagated (SGP4) from published element sets, not observed.',
  count: (d) => d.rows.length,
  // Never hammer CelesTrak after a failure (TLS resets / firewall after 50 errors in 2 h).
  retryAfterErrorMs: 20 * MIN,
  deadlineMs: 180_000,
  idleStopMs: 6 * 60 * MIN,
  run: runSatellites,
});

export const spaceWeatherFeed = defineFeed<SpaceWeatherData>({
  key: 'space-weather',
  ttlMs: 5 * MIN,
  kind: 'live',
  attribution: [{ text: 'NOAA Space Weather Prediction Center', url: 'https://www.swpc.noaa.gov/', licence: 'Public domain (US Government)' }],
  count: (d) => (d.kp.kp !== null ? 1 : 0) + (d.solarWind.observedAt ? 1 : 0) + (d.xray.flux !== null ? 1 : 0),
  // Kp alone may be missing while RTSW/X-ray answer; only "nothing at all" is an empty refresh.
  isEmpty: (d) => d.kp.kp === null && d.solarWind.observedAt === null && d.xray.flux === null && d.alerts.length === 0,
  retryAfterErrorMs: 2 * MIN,
  // RTSW and GOES update every minute: an hour without a new sample is not LIVE.
  maxObservationAgeMs: 60 * MIN,
  run: runSpaceWeather,
});

export const issFeed = defineFeed<IssPosition>({
  key: 'iss',
  ttlMs: 5_000,
  kind: 'live',
  attribution: [{ text: 'ISS position: Where the ISS at?', url: 'https://wheretheiss.at/w/developer' }],
  count: () => 1,
  isEmpty: () => false,
  retryAfterErrorMs: 30_000,
  maxObservationAgeMs: 60_000,
  idleStopMs: 2 * MIN,
  run: runIss,
});

export const feeds: Feed<unknown>[] = [satellitesFeed, spaceWeatherFeed, issFeed] as Feed<unknown>[];
