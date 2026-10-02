/**
 * Display names for the `source` ids entity selections carry (n7): cards show the catalogue name
 * from `src/lib/sources.ts` ("USGS Earthquake Hazards Program"), never the raw id ("usgs").
 * Owner: design-system-hud.
 */
import { SOURCES, sourcesForLayer } from '@/lib/sources';

const BY_ID = new Map(SOURCES.map((s) => [s.id, s.name]));

/**
 * Feed-level ids that name one product of a catalogue entry, or a provider whose catalogue id
 * differs. Products get their own name (the catalogue entry covers several); others map to the id.
 */
const PRODUCT_NAMES: Readonly<Record<string, string>> = {
  urlhaus: 'abuse.ch URLhaus',
  threatfox: 'abuse.ch ThreatFox',
  feodo: 'abuse.ch Feodo Tracker',
  // One FIRMS (LANCE) catalogue entry, four instruments: the fire card lists each on its own row.
  firms_viirs_snpp: 'NASA FIRMS VIIRS S-NPP',
  firms_viirs_noaa20: 'NASA FIRMS VIIRS NOAA-20',
  firms_viirs_noaa21: 'NASA FIRMS VIIRS NOAA-21',
  firms_modis: 'NASA FIRMS MODIS',
};
const ALIASES: Readonly<Record<string, string>> = {
  adsblol_tiles: 'adsblol',
  adsblol_mil: 'adsblol',
  adsblol_ladd: 'adsblol',
  adsblol_pia: 'adsblol',
  cloudflare: 'cloudflare-radar',
  wpi: 'nga-wpi',
  youtube: 'youtube-live',
  curated: 'osiris-curated',
  flightplandatabase: 'fpdb',
  openmeteo: 'open-meteo',
  gibs: 'nasa-gibs',
};

function one(raw: string): string | null {
  const id = raw.trim();
  if (!id) return null;
  const key = id.toLowerCase();
  if (PRODUCT_NAMES[key]) return PRODUCT_NAMES[key];
  const direct = BY_ID.get(key) ?? BY_ID.get(`cam:${key}`) ?? (ALIASES[key] ? BY_ID.get(ALIASES[key]) : undefined);
  if (direct) return direct;
  // "adsblol_foo", "usgs-fdsn": the provider before the first separator.
  const head = key.split(/[_:]/)[0]!;
  return BY_ID.get(head) ?? BY_ID.get(`cam:${head}`) ?? null;
}

/**
 * The readable name for a selection's `source` (one id or a comma/plus-separated list). Unknown
 * ids fall back to the layer's only catalogue source, then to the id itself in capitals (already
 * human-readable strings such as "ACE" or "NOAA SWPC" are returned unchanged).
 */
export function sourceDisplayName(source: string | null | undefined, layerId?: string): string {
  const raw = (source ?? '').trim();
  if (!raw) return '—';
  const parts = raw.split(/\s*[,+]\s*/).filter(Boolean);
  const names = parts.map((p) => {
    const hit = one(p);
    if (hit) return hit;
    if (parts.length === 1 && layerId) {
      const layerSources = sourcesForLayer(layerId);
      if (layerSources.length === 1) return layerSources[0]!.name;
    }
    return /[A-Z\s]/.test(p) ? p : p.toUpperCase();
  });
  return [...new Set(names)].join(' + ');
}
