/**
 * Process-wide constants: identity, honest User-Agent, repo URL. Server and client safe
 * (no secrets). Owner: lead.
 */
import pkg from '../../package.json';

export const APP_NAME = 'GODSEYE';
export const APP_SUBTITLE = 'GLOBAL INTELLIGENCE MONITOR';
export const APP_STRAPLINE = 'REAL-TIME GLOBAL MONITORING · FLIGHTS · MARITIME · SATELLITES · CCTV · HAZARDS · CYBER';
export const APP_VERSION: string = pkg.version;
export const REPO_URL = 'https://github.com/awne8886/godseye';

/**
 * Identifying User-Agent sent on every upstream request (§0.5). Operators set GODSEYE_CONTACT
 * to an email or URL where providers can reach them; the default points at the issue tracker.
 */
export function userAgent(env: Record<string, string | undefined> = process.env): string {
  const contact = env.GODSEYE_CONTACT?.trim() || `${REPO_URL}/issues`;
  return `${APP_NAME}/${APP_VERSION} (+${REPO_URL}; contact ${contact})`;
}
