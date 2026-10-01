/**
 * Satellite catalogue model shared by the server feed, the propagation worker and the cards.
 * Isomorphic and pure. Owner: layers-space.
 *
 * §6.2 breaking changes encoded here:
 *  - CelesTrak's default format has been CSV since 2026-05-09: always request `FORMAT=json` (OMM).
 *  - Catalog numbers passed 99999 on 2026-07-11: NORAD ids are plain integers (6 digits); never
 *    read them from TLE columns 3–7 (Alpha-5) when an integer id is available.
 *  - OMM `EPOCH` has no zone designator ("2026-09-30T05:11:37.538880"); it is UTC and goes
 *    through normalizeUtc() before it is served.
 */
import { MAP_TOKENS, type MapToken } from '@/lib/tokens';
import { normalizeUtc } from '@/lib/freshness';
import { SATELLITE_FIELDS } from './fields';
import type { Mission, Omm, SatCategory } from '@/lib/types';

export const SAT_CATEGORIES = ['comms', 'military', 'navigation', 'earth_obs', 'science', 'other'] as const satisfies readonly SatCategory[];

/** Colour token per category (the layer registry uses the same tokens for the sub-layer toggles). */
export const CATEGORY_TOKEN: Record<SatCategory, MapToken> = {
  comms: '--map-sat-comms',
  military: '--map-sat-military',
  navigation: '--map-sat-navigation',
  earth_obs: '--map-sat-earth',
  science: '--map-sat-science',
  other: '--map-sat-other',
};

export const CATEGORY_LABEL: Record<SatCategory, string> = {
  comms: 'Communications',
  military: 'Military / Intel',
  navigation: 'Navigation',
  earth_obs: 'Earth Observation',
  science: 'Stations / Science',
  other: 'Other',
};

/** Satellite sub-layer id → category (mirrors `countKey` in the layer registry). */
export const LAYER_CATEGORY = {
  sat_comms: 'comms',
  sat_military: 'military',
  sat_navigation: 'navigation',
  sat_earth: 'earth_obs',
  sat_science: 'science',
} as const satisfies Record<string, SatCategory>;

interface MissionRule {
  name: string;
  category: SatCategory;
  /** Matched against the upper-cased OBJECT_NAME. Anchored/word-bounded to avoid OSIRIS's substring false positives ("USA" in "USASAT"). */
  test: RegExp;
}

/**
 * Name rules, first match wins. Checked against the 2026-09-30 `active` catalogue (16 612 objects).
 * Debris and rocket bodies come first so "STARLINK DEB" never counts as a Starlink.
 */
const NAME_RULES: readonly MissionRule[] = [
  { name: 'Debris / rocket body', category: 'other', test: /\b(DEB|R\/B)\b/ },
  { name: 'Space station', category: 'science', test: /^(ISS|CSS) \(|^TIANGONG\b/ },
  { name: 'Space telescope', category: 'science', test: /^(HST|SWIFT|TESS|NUSTAR|CHANDRA|XMM|INTEGRAL|FERMI|GAIA|JWST)\b/ },
  { name: 'Starlink', category: 'comms', test: /^STARLINK\b/ },
  { name: 'OneWeb', category: 'comms', test: /^ONEWEB\b/ },
  { name: 'Kuiper', category: 'comms', test: /^KUIPER\b/ },
  { name: 'Qianfan / Guowang', category: 'comms', test: /^(QIANFAN|GUOWANG|HULIANWANG)\b/ },
  { name: 'Iridium / Globalstar / Orbcomm', category: 'comms', test: /^(IRIDIUM|GLOBALSTAR|ORBCOMM)\b/ },
  { name: 'GEO communications', category: 'comms', test: /^(INTELSAT|EUTELSAT|INMARSAT|ECHOSTAR|ASTRA|GALAXY|JCSAT|ZHONGXING)\b|^SES-\d/ },
  { name: 'GPS', category: 'navigation', test: /^NAVSTAR\b/ },
  { name: 'GLONASS', category: 'navigation', test: /\[GLONASS/ },
  { name: 'Galileo', category: 'navigation', test: /\(GALILEO/ },
  { name: 'BeiDou', category: 'navigation', test: /^BEIDOU\b/ },
  { name: 'QZSS / NavIC', category: 'navigation', test: /^(QZS|IRNSS)-/ },
  { name: 'US military', category: 'military', test: /\bUSA \d+|^(WGS F\d|MILSTAR|AEHF|SBIRS|MUOS|NROL)\b|^(PRAETORIAN )?SDA\b/ },
  { name: 'Chinese military', category: 'military', test: /^(YAOGAN|TJS)\b/ },
  { name: 'Russian military', category: 'military', test: /^COSMOS \d+$/ },
  { name: 'Weather', category: 'earth_obs', test: /^(NOAA \d|METEOSAT|FENGYUN|HIMAWARI|METOP|DMSP|GK-2A|ELEKTRO|METEOR-M)|\bGOES\b/ },
  {
    name: 'Earth imaging',
    category: 'earth_obs',
    test: /^(SENTINEL|LANDSAT|WORLDVIEW|SKYSAT|FLOCK|LEMUR|JILIN|GAOFEN|SUPERVIEW|ICEYE|CAPELLA|PLEIADES|SPOT|TERRA|AQUA|AURA|GRUS|NUSAT|STRIX|QPS-SAR|HAIYANG|GHGSAT)\b/,
  },
];

/**
 * CelesTrak groups fetched besides `active`, each mapped to a category and mission label. Kept short:
 * CelesTrak firewalls an IP after 50 HTTP errors in 2 h, and this sandbox saw TLS resets on the
 * second group request (2026-09-30), so every extra group is a liability. Starlink/OneWeb/Kuiper are
 * classified by name instead of downloading their (rate-limited) groups again.
 */
export const CELESTRAK_GROUPS: readonly { group: string; category: SatCategory; mission: string }[] = [
  { group: 'stations', category: 'science', mission: 'Station traffic' },
  { group: 'science', category: 'science', mission: 'Science' },
  { group: 'geodetic', category: 'science', mission: 'Geodesy' },
  { group: 'gps-ops', category: 'navigation', mission: 'GPS' },
  // `glo-ops` (probed 2026-10-01: 29 objects); `glonass-operational` answers 200 text "GROUP not found".
  { group: 'glo-ops', category: 'navigation', mission: 'GLONASS' },
  { group: 'galileo', category: 'navigation', mission: 'Galileo' },
  { group: 'beidou', category: 'navigation', mission: 'BeiDou' },
  { group: 'military', category: 'military', mission: 'Military (CelesTrak list)' },
  { group: 'radar', category: 'military', mission: 'Radar calibration' },
  { group: 'weather', category: 'earth_obs', mission: 'Weather' },
  { group: 'resource', category: 'earth_obs', mission: 'Earth resources' },
  { group: 'other-comm', category: 'comms', mission: 'Communications' },
];

const GROUP_MISSION_NAMES = CELESTRAK_GROUPS.map((g) => ({ name: g.mission, category: g.category }));

/** Stable mission table: `missionIndex` in every row indexes this array. */
export const MISSIONS: readonly Mission[] = (() => {
  const seen = new Set<string>();
  const out: Mission[] = [];
  for (const m of [...NAME_RULES, ...GROUP_MISSION_NAMES, { name: 'Unclassified', category: 'other' as const }]) {
    const key = `${m.name}\u0000${m.category}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: m.name, category: m.category, color: MAP_TOKENS[CATEGORY_TOKEN[m.category]] });
  }
  return out;
})();

const missionIndexOf = (name: string, category: SatCategory) => MISSIONS.findIndex((m) => m.name === name && m.category === category);
const UNCLASSIFIED = missionIndexOf('Unclassified', 'other');

export interface Classification {
  category: SatCategory;
  missionIndex: number;
  /** The CelesTrak group that decided (or the first specific group the object is in); `active` otherwise. */
  group: string;
}

/** Classify by name rules, then by curated CelesTrak group membership, else `other`. */
export function classifySatellite(name: string, groups: readonly string[] = []): Classification {
  const upper = name.toUpperCase().trim();
  const specific = groups.find((g) => g !== 'active');
  for (const rule of NAME_RULES) {
    if (rule.test.test(upper)) return { category: rule.category, missionIndex: missionIndexOf(rule.name, rule.category), group: specific ?? groups[0] ?? 'active' };
  }
  for (const g of CELESTRAK_GROUPS) {
    if (groups.includes(g.group)) return { category: g.category, missionIndex: missionIndexOf(g.mission, g.category), group: g.group };
  }
  return { category: 'other', missionIndex: UNCLASSIFIED, group: specific ?? groups[0] ?? 'active' };
}

/** One catalogue record in SATELLITE_FIELDS order (what the route serves and the worker reads). */
export interface SatRecord {
  noradId: number;
  name: string;
  objectId: string;
  /** Element-set epoch, ISO-8601 UTC with Z. */
  epoch: string;
  meanMotion: number;
  eccentricity: number;
  inclination: number;
  raan: number;
  argOfPericenter: number;
  meanAnomaly: number;
  bstar: number;
  meanMotionDot: number;
  meanMotionDdot: number;
  elementSetNo: number;
  revAtEpoch: number;
  category: SatCategory;
  missionIndex: number;
  group: string;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Validate and normalise one CelesTrak OMM object. Returns null (the record is dropped and
 * counted) when a field SGP4 needs is missing or non-numeric — never patched with a guess.
 */
export function ommToRecord(o: Partial<Omm> | null | undefined, groups: readonly string[] = ['active']): SatRecord | null {
  if (!o || typeof o !== 'object') return null;
  const id = o.NORAD_CAT_ID;
  if (!finite(id) || !Number.isInteger(id) || id <= 0 || id > 999_999) return null;
  const epoch = normalizeUtc(typeof o.EPOCH === 'string' ? o.EPOCH : null);
  if (!epoch) return null;
  const nums = [o.MEAN_MOTION, o.ECCENTRICITY, o.INCLINATION, o.RA_OF_ASC_NODE, o.ARG_OF_PERICENTER, o.MEAN_ANOMALY, o.BSTAR, o.MEAN_MOTION_DOT, o.MEAN_MOTION_DDOT];
  if (!nums.every(finite)) return null;
  if (!(o.MEAN_MOTION! > 0) || o.ECCENTRICITY! < 0 || o.ECCENTRICITY! >= 1) return null;
  const name = typeof o.OBJECT_NAME === 'string' && o.OBJECT_NAME.trim() ? o.OBJECT_NAME.trim() : `NORAD ${id}`;
  const cls = classifySatellite(name, groups);
  return {
    noradId: id,
    name,
    objectId: typeof o.OBJECT_ID === 'string' ? o.OBJECT_ID : '',
    epoch,
    meanMotion: o.MEAN_MOTION!,
    eccentricity: o.ECCENTRICITY!,
    inclination: o.INCLINATION!,
    raan: o.RA_OF_ASC_NODE!,
    argOfPericenter: o.ARG_OF_PERICENTER!,
    meanAnomaly: o.MEAN_ANOMALY!,
    bstar: o.BSTAR!,
    meanMotionDot: o.MEAN_MOTION_DOT!,
    meanMotionDdot: o.MEAN_MOTION_DDOT!,
    elementSetNo: finite(o.ELEMENT_SET_NO) ? o.ELEMENT_SET_NO : 0,
    revAtEpoch: finite(o.REV_AT_EPOCH) ? o.REV_AT_EPOCH : 0,
    ...cls,
  };
}

/** Rebuild the OMM object `json2satrec` needs from a served row (client/worker side). */
export function recordToOmm(r: Pick<SatRecord, Exclude<keyof SatRecord, 'category' | 'missionIndex' | 'group'>>): Omm {
  return {
    OBJECT_NAME: r.name,
    OBJECT_ID: r.objectId,
    EPOCH: r.epoch,
    MEAN_MOTION: r.meanMotion,
    ECCENTRICITY: r.eccentricity,
    INCLINATION: r.inclination,
    RA_OF_ASC_NODE: r.raan,
    ARG_OF_PERICENTER: r.argOfPericenter,
    MEAN_ANOMALY: r.meanAnomaly,
    EPHEMERIS_TYPE: 0,
    CLASSIFICATION_TYPE: 'U',
    NORAD_CAT_ID: r.noradId,
    ELEMENT_SET_NO: r.elementSetNo,
    REV_AT_EPOCH: r.revAtEpoch,
    BSTAR: r.bstar,
    MEAN_MOTION_DOT: r.meanMotionDot,
    MEAN_MOTION_DDOT: r.meanMotionDdot,
  };
}

// ── TLE (SatNOGS fallback) ─────────────────────────────────────────────────────
function tleExp(field: string): number {
  // "-11606-4" → -0.11606e-4 (implied leading decimal point, signed exponent)
  const s = field.trim();
  if (!s) return 0;
  const m = /^([+-]?)(\d+)([+-]\d)$/.exec(s.replace(/\s/g, ''));
  if (!m) return Number.NaN;
  return Number(`${m[1]}0.${m[2]}e${m[3]}`);
}

/** TLE line checksum (mod 10, '-' counts 1). */
export function tleChecksumOk(line: string): boolean {
  if (line.length < 69) return false;
  let sum = 0;
  for (const ch of line.slice(0, 68)) {
    if (ch >= '0' && ch <= '9') sum += Number(ch);
    else if (ch === '-') sum += 1;
  }
  return sum % 10 === Number(line[68]);
}

/**
 * Parse a TLE pair into an OMM object. `noradId` is the integer id the source supplies alongside
 * the TLE (SatNOGS `norad_cat_id`), which is authoritative past 99999 (TLE columns are Alpha-5).
 * Returns null on a malformed or checksum-failing pair.
 */
export function tleToOmm(name: string, line1: string, line2: string, noradId: number): Omm | null {
  const l1 = line1.trimEnd();
  const l2 = line2.trimEnd();
  if (!l1.startsWith('1 ') || !l2.startsWith('2 ') || !tleChecksumOk(l1) || !tleChecksumOk(l2)) return null;
  const yy = Number(l1.slice(18, 20));
  const doy = Number(l1.slice(20, 32));
  if (!Number.isFinite(yy) || !Number.isFinite(doy)) return null;
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  const epochMs = Date.UTC(year, 0, 1) + (doy - 1) * 86_400_000;
  const intl = l1.slice(9, 17).trim();
  const objectId = /^\d{5}/.test(intl) ? `${Number(intl.slice(0, 2)) < 57 ? '20' : '19'}${intl.slice(0, 2)}-${intl.slice(2)}` : intl;
  const omm: Omm = {
    OBJECT_NAME: name.replace(/^0\s+/, '').trim(),
    OBJECT_ID: objectId,
    EPOCH: new Date(epochMs).toISOString(),
    MEAN_MOTION: Number(l2.slice(52, 63)),
    ECCENTRICITY: Number(`0.${l2.slice(26, 33).trim()}`),
    INCLINATION: Number(l2.slice(8, 16)),
    RA_OF_ASC_NODE: Number(l2.slice(17, 25)),
    ARG_OF_PERICENTER: Number(l2.slice(34, 42)),
    MEAN_ANOMALY: Number(l2.slice(43, 51)),
    EPHEMERIS_TYPE: Number(l1.slice(62, 63)) || 0,
    CLASSIFICATION_TYPE: l1.slice(7, 8) || 'U',
    NORAD_CAT_ID: noradId,
    ELEMENT_SET_NO: Number(l1.slice(64, 68)) || 0,
    REV_AT_EPOCH: Number(l2.slice(63, 68)) || 0,
    BSTAR: tleExp(l1.slice(53, 61)),
    MEAN_MOTION_DOT: Number(l1.slice(33, 43)),
    MEAN_MOTION_DDOT: tleExp(l1.slice(44, 52)),
  };
  const nums = [omm.MEAN_MOTION, omm.ECCENTRICITY, omm.INCLINATION, omm.RA_OF_ASC_NODE, omm.ARG_OF_PERICENTER, omm.MEAN_ANOMALY, omm.BSTAR, omm.MEAN_MOTION_DOT, omm.MEAN_MOTION_DDOT];
  return nums.every(Number.isFinite) ? omm : null;
}

// ── Columnar ───────────────────────────────────────────────────────────────────
/**
 * A served row. `epoch` travels as integer ms since the Unix epoch (UTC): lossless against the ms
 * precision the ISO form already had, and 13 bytes/row smaller (≈ 216 kB on the 16.6k catalogue).
 * Snapshots written before 2026-10-01 carry the ISO string; every decoder accepts both.
 */
export type SatRow = [
  number, string, string, number | string, number, number, number, number, number, number, number, number, number, number, number, SatCategory, number, string,
];

export function recordToRow(r: SatRecord): SatRow {
  return [
    r.noradId, r.name, r.objectId, Date.parse(r.epoch), r.meanMotion, r.eccentricity, r.inclination, r.raan, r.argOfPericenter, r.meanAnomaly,
    r.bstar, r.meanMotionDot, r.meanMotionDdot, r.elementSetNo, r.revAtEpoch, r.category, r.missionIndex, r.group,
  ];
}

/** A row's `epoch` cell (ms number, or the ISO string of older snapshots) as ISO-8601 UTC; '' when unreadable. */
export function epochIso(v: unknown): string {
  if (typeof v === 'number') return Number.isFinite(v) ? new Date(v).toISOString() : '';
  if (typeof v === 'string') return normalizeUtc(v) ?? '';
  return '';
}

/** A row's `epoch` cell as ms since the Unix epoch, NaN when unreadable. */
export function epochMs(v: unknown): number {
  if (typeof v === 'number') return v;
  return typeof v === 'string' ? Date.parse(normalizeUtc(v) ?? '') : Number.NaN;
}

/** Field positions in a served row (SATELLITE_FIELDS order). */
export const COL = Object.fromEntries(SATELLITE_FIELDS.map((f, i) => [f, i])) as { [K in (typeof SATELLITE_FIELDS)[number]]: number };

export function rowToRecord(row: readonly unknown[]): SatRecord {
  const o: Record<string, unknown> = {};
  SATELLITE_FIELDS.forEach((f, i) => (o[f] = row[i]));
  o.epoch = epochIso(o.epoch);
  return o as unknown as SatRecord;
}

export function countByCategory(rows: readonly (readonly unknown[])[]): Record<SatCategory, number> {
  const out = Object.fromEntries(SAT_CATEGORIES.map((c) => [c, 0])) as Record<SatCategory, number>;
  for (const r of rows) {
    const c = r[COL.category] as SatCategory;
    if (c in out) out[c] += 1;
  }
  return out;
}
