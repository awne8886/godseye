/**
 * Orbit arithmetic that needs no SGP4: period, regime, the globe's display altitude. Kept free of
 * satellite.js so the main-thread layer and the card never pull the propagator into their chunks
 * (the propagator runs only in the tle-propagate worker and on the server). Owner: layers-space.
 */
import type { OrbitClass } from '@/lib/types';

export const ISS_NORAD_ID = 25544;

/** Orbital period in minutes from mean motion (rev/day). */
export function periodMinutes(meanMotionRevPerDay: number): number | null {
  return Number.isFinite(meanMotionRevPerDay) && meanMotionRevPerDay > 0 ? 1440 / meanMotionRevPerDay : null;
}

const MU = 398_600.4418; // km³/s²
const EARTH_EQ_RADIUS_KM = 6378.137;

/**
 * Orbit regime from the elements (not from the instantaneous altitude, which misfiles a Molniya
 * at perigee as LEO): HEO when eccentricity ≥ 0.25; otherwise by mean altitude — LEO < 2 000 km,
 * GEO when the period is within 1 % of a sidereal day, MEO in between, HEO above.
 */
export function orbitClass(meanMotionRevPerDay: number, eccentricity: number): OrbitClass {
  const nRadS = (meanMotionRevPerDay * 2 * Math.PI) / 86_400;
  const aKm = Math.cbrt(MU / (nRadS * nRadS));
  const meanAlt = aKm - EARTH_EQ_RADIUS_KM;
  const period = 1440 / meanMotionRevPerDay;
  if (eccentricity >= 0.25) return 'HEO';
  if (meanAlt < 2000) return 'LEO';
  if (Math.abs(period - 1436.07) / 1436.07 < 0.01) return 'GEO';
  if (meanAlt < 35_000) return 'MEO';
  return 'HEO';
}

/**
 * Display altitude on the globe, in metres. True altitudes span 160 km (LEO) to 36 000 km (GEO),
 * which would put GEO five Earth radii off the globe; a square-root compression keeps every shell
 * visible and in order (LEO ≈ 450 km, MEO ≈ 1 400 km, GEO ≈ 1 750 km). Cards show the true value.
 */
export function displayAltM(altKm: number): number {
  return (250 + 1500 * Math.sqrt(Math.max(0, altKm) / 36_000)) * 1000;
}
