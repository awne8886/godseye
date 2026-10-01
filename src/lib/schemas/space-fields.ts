/**
 * Column names of GET /api/satellites rows (OMM elements + GODSEYE classification), in row order.
 * Zod-free on purpose: the main-thread layer, the cards and the tle-propagate worker read rows by
 * these names, and importing them from the zod contract pulled zod (88.6 KB gz) onto `/` and into
 * the worker (perf round 5 m-k). `./space.ts` re-exports this constant, so the
 * contract and `columnarResponse(SATELLITE_FIELDS)` are unchanged. Owner: layers-space.
 *
 * `epoch` is the element-set epoch as integer ms since the Unix epoch, UTC (`epochUnit: 'ms'`);
 * responses built from snapshots older than 2026-10-01 may still carry the ISO-8601 string. An
 * epoch is when the element set is valid, not an observation, and CelesTrak publishes a few in the
 * future (e.g. CXO).
 */
export const SATELLITE_FIELDS = [
  'noradId',
  'name',
  'objectId',
  'epoch',
  'meanMotion',
  'eccentricity',
  'inclination',
  'raan',
  'argOfPericenter',
  'meanAnomaly',
  'bstar',
  'meanMotionDot',
  'meanMotionDdot',
  'elementSetNo',
  'revAtEpoch',
  'category',
  'missionIndex',
  'group',
] as const;

export type SatelliteField = (typeof SATELLITE_FIELDS)[number];
