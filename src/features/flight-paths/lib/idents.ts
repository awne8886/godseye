/**
 * Flight identifier classification for "track my flight" (§8): ICAO callsign (BAW117), IATA
 * flight number (BA117), registration (G-XWBA, N12345) or ICAO 24-bit hex (4ca2b3). Also the
 * route-endpoint code grammar shared by /api/route/* and the panel. Isomorphic, pure.
 * Owner: feature-flight-paths.
 */

export type IdentKind = 'callsign' | 'iata' | 'registration' | 'hex';

export interface IdentGuess {
  kind: IdentKind;
  value: string;
  /** IATA designator + number for `iata`. */
  airline?: string;
  number?: string;
}

const HEX = /^[0-9A-F]{6}$/;
/** ICAO airline designator (3 letters) + flight number (digit first, ≤ 4 chars + optional suffix). */
const ICAO_CS = /^([A-Z]{3})(\d[A-Z0-9]{0,4})$/;
/** IATA designator (2 chars, at least one letter) + 1–4 digits + optional operational suffix. */
const IATA_FLIGHT = /^([A-Z][A-Z0-9]|[0-9][A-Z])(\d{1,4}[A-Z]?)$/;
const REG_DASH = /^[A-Z0-9]{1,3}-[A-Z0-9]{1,5}$/;
const REG_US = /^N[1-9][0-9]{0,4}[A-Z]{0,2}$/;

export function normalizeIdent(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * Candidate readings of an ident, most likely first. Ambiguous strings get several (e.g. ACA123
 * is a callsign and also valid hex; the resolver tries each in order).
 */
export function classifyIdent(raw: string): IdentGuess[] {
  const v = normalizeIdent(raw);
  const out: IdentGuess[] = [];
  if (REG_DASH.test(v)) out.push({ kind: 'registration', value: v });
  if (ICAO_CS.test(v)) out.push({ kind: 'callsign', value: v });
  const iata = IATA_FLIGHT.exec(v);
  if (iata) out.push({ kind: 'iata', value: v, airline: iata[1]!, number: String(Number(iata[2]!.replace(/[A-Z]$/, ''))) + (/[A-Z]$/.test(iata[2]!) ? iata[2]!.slice(-1) : '') });
  if (REG_US.test(v) && !out.some((g) => g.kind === 'registration')) out.push({ kind: 'registration', value: v });
  if (HEX.test(v)) out.push({ kind: 'hex', value: v.toLowerCase() });
  if (!out.length && /^[A-Z0-9]{2,8}$/.test(v)) out.push({ kind: 'callsign', value: v });
  return out;
}

/** Airport code accepted by the route endpoints: IATA (3), ICAO (4) or an OurAirports ident. */
export const AIRPORT_CODE_RE = /^[A-Z0-9][A-Z0-9-]{1,9}$/;
