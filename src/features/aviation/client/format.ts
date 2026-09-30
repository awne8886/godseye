/** Aviation display helpers (units are the contract's: ft, kt, ft/min). Isomorphic and pure. */
import type { Bucket } from '../classify';
import type { FlightRecord } from '../adsb';
import { JET_SILHOUETTE_TYPES } from '../classify';

export function formatAlt(r: Pick<FlightRecord, 'onGround' | 'altFt'>): string {
  if (r.onGround) return 'GROUND';
  if (r.altFt === null) return '—';
  return r.altFt >= 18_000 ? `FL${String(Math.round(r.altFt / 100)).padStart(3, '0')}` : `${Math.round(r.altFt / 25) * 25} FT`;
}

export const formatKt = (v: number | null) => (v === null ? '—' : `${Math.round(v)} KT`);
export const formatDeg = (v: number | null) => (v === null ? '—' : `${String(Math.round(v) % 360).padStart(3, '0')}°`);
export const formatFpm = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${Math.round(v / 50) * 50} FPM`);

export const BUCKET_LABEL: Record<Bucket, string> = { commercial: 'COMMERCIAL', private: 'PRIVATE', jet: 'PRIVATE JET', military: 'MILITARY' };

export const EMERGENCY_LABEL: Record<'7500' | '7600' | '7700', string> = {
  '7500': 'HIJACK (7500)',
  '7600': 'RADIO FAILURE (7600)',
  '7700': 'GENERAL EMERGENCY (7700)',
};

export const POS_SOURCE_LABEL: Record<NonNullable<FlightRecord['posSource']>, string> = {
  adsb: 'ADS-B',
  mlat: 'MLAT (multilateration, less precise)',
  tisb: 'TIS-B (radar rebroadcast, less precise)',
  adsr: 'ADS-R (rebroadcast)',
  other: 'Other',
};

/** readsb trace `source` strings → the same labels. */
export function traceSourceLabel(s: string | null): string | null {
  if (!s) return null;
  if (s.startsWith('adsb')) return POS_SOURCE_LABEL.adsb;
  if (s === 'mlat') return POS_SOURCE_LABEL.mlat;
  if (s.startsWith('tisb')) return POS_SOURCE_LABEL.tisb;
  if (s.startsWith('adsr')) return POS_SOURCE_LABEL.adsr;
  return s.toUpperCase();
}

export const PROVIDER_LABEL: Record<string, string> = {
  adsblol_tiles: 'adsb.lol (area sweep)',
  adsblol_mil: 'adsb.lol /v2/mil',
  adsblol_ladd: 'adsb.lol /v2/ladd',
  adsblol_pia: 'adsb.lol /v2/pia',
  adsblol_reapi: 'adsb.lol re-api',
  opensky: 'OpenSky Network',
  adsbfi_mil: 'adsb.fi /v2/mil',
};

export type IconKind = 'plane' | 'jet' | 'heli';

export function iconFor(r: Pick<FlightRecord, 'isHelicopter' | 'bucket' | 'typeCode'>): IconKind {
  if (r.isHelicopter) return 'heli';
  if (r.bucket === 'jet' || (r.typeCode !== null && JET_SILHOUETTE_TYPES.has(r.typeCode))) return 'jet';
  return 'plane';
}

/** 0..1 position of an altitude on the colour ramp (0 ft → 0, 45 000 ft and above → 1). */
export function altitudeRamp(altFt: number | null): number {
  if (altFt === null) return 0;
  return Math.max(0, Math.min(1, altFt / 45_000));
}
