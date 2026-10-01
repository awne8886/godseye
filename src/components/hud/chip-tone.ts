/**
 * Chip tones for map-corner chips (m3). REFERENCE / dated imagery chips are neutral grey; a source
 * that is down (BASEMAP OFFLINE, terrain unavailable) uses the alert token so it stands out at a
 * glance. base.css styles `[data-tone='offline']` inside `.godseye-imagery-chips` (and the basemap
 * chip by id until map-engine sets the attribute). Owner: design-system-hud.
 */
export type ChipTone = 'reference' | 'offline';

/** CSS colour token per tone (text + outline). */
export const CHIP_TONE_TOKEN: Record<ChipTone, string> = {
  reference: '--text-secondary',
  offline: '--alert-orange',
};

/** Tone of an imagery chip from map-engine: `basemap` only exists while the basemap is offline. */
export function imageryChipTone(chip: { id: string; text: string }): ChipTone {
  if (chip.id === 'basemap') return 'offline';
  if (chip.id === 'terrain' && /unavailable|offline|error/i.test(chip.text)) return 'offline';
  return 'reference';
}
