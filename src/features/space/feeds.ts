/**
 * Server-side feeds for space. Owner: layers-space. Server-only.
 * List every Feed defined with defineFeed() in this area so instrumentation can start the eager
 * ones and /api/health reports them before their first request.
 */
import 'server-only';
import { defineFeed, type Feed } from '@/lib/feeds';
import { runSatellites, satelliteRecoveryTick, type SatCatalogue } from './server/satellites';
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
  // The poller only refreshes when the 2 h TTL or the 20 min error back-off is due; a 5 min check
  // makes that back-off real instead of waiting for the next 2 h tick.
  pollMs: 5 * MIN,
  deadlineMs: 180_000,
  idleStopMs: 6 * 60 * MIN,
  run: runSatellites,
});

// ── CelesTrak recovery loop (fallback → CelesTrak, missing groups) ─────────────────
const RECOVERY_CHECK_MS = 5 * MIN;
const RECOVERY_IDLE_MS = 6 * 60 * MIN;
const R = globalThis as unknown as { __godseyeSatRecovery?: { timer: ReturnType<typeof setInterval> | null; lastRead: number } };
const recovery = (R.__godseyeSatRecovery ??= { timer: null, lastRead: 0 });

function recoveryCheck(): void {
  if (Date.now() - recovery.lastRead > RECOVERY_IDLE_MS) {
    if (recovery.timer) clearInterval(recovery.timer);
    recovery.timer = null;
    return;
  }
  void satelliteRecoveryTick(satellitesFeed.peek().data, () => satellitesFeed.refresh()).catch(() => undefined);
}

/**
 * Called by the satellite routes on every read: keeps a 5-minute recovery check running while the
 * catalogue has readers (stops after 6 h without one). The check itself is in-memory unless a
 * CelesTrak retry or a missing-group retry is due (see satelliteRecoveryTick).
 */
export function noteSatellitesRead(): void {
  recovery.lastRead = Date.now();
  if (recovery.timer) return;
  recovery.timer = setInterval(recoveryCheck, RECOVERY_CHECK_MS);
  recovery.timer.unref?.();
}

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
  note: 'The ISS position is computed (SGP4) by wheretheiss.at from NORAD TLEs, not observed; observedAt is the instant it was computed for.',
  count: () => 1,
  isEmpty: () => false,
  retryAfterErrorMs: 30_000,
  maxObservationAgeMs: 60_000,
  idleStopMs: 2 * MIN,
  run: runIss,
});

export const feeds: Feed<unknown>[] = [satellitesFeed, spaceWeatherFeed, issFeed] as Feed<unknown>[];
