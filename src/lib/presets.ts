/**
 * Region presets (OSIRIS's 12, docs/reference/02): camera targets for the presets panel, the
 * command palette and the mobile layers sheet. Icons are lucide names (no emoji). OSIRIS
 * hard-coded "HOT" regions; GODSEYE derives heat from live alert counts at runtime instead.
 * Owner: lead.
 */
export interface RegionPreset {
  id: string;
  label: string;
  lat: number;
  lng: number;
  zoom: number;
  icon: string;
}

export const REGION_PRESETS = [
  { id: 'global', label: 'GLOBAL', lat: 20, lng: 0, zoom: 2.5, icon: 'Earth' },
  { id: 'europe', label: 'EUROPE', lat: 48, lng: 10, zoom: 4, icon: 'Globe' },
  { id: 'middle-east', label: 'MIDDLE EAST', lat: 30, lng: 45, zoom: 4.5, icon: 'Globe' },
  { id: 'east-asia', label: 'EAST ASIA', lat: 35, lng: 120, zoom: 4, icon: 'Globe' },
  { id: 'americas', label: 'AMERICAS', lat: 25, lng: -90, zoom: 3, icon: 'Globe' },
  { id: 'ukraine', label: 'UKRAINE', lat: 49, lng: 32, zoom: 6, icon: 'MapPin' },
  { id: 'africa', label: 'AFRICA', lat: 5, lng: 20, zoom: 3.5, icon: 'Globe' },
  { id: 'se-asia', label: 'S.E. ASIA', lat: 10, lng: 110, zoom: 4.5, icon: 'Globe' },
  { id: 'arctic', label: 'ARCTIC', lat: 75, lng: 0, zoom: 3.5, icon: 'Snowflake' },
  { id: 'india', label: 'INDIA', lat: 22, lng: 78, zoom: 4.5, icon: 'Globe' },
  { id: 'australia', label: 'AUSTRALIA', lat: -25, lng: 134, zoom: 4, icon: 'Globe' },
  { id: 'sudan', label: 'SUDAN', lat: 15, lng: 30, zoom: 5.5, icon: 'MapPin' },
] as const satisfies readonly RegionPreset[];

/**
 * Well-covered landing cities for the optional intro fly-in when the visitor declines
 * geolocation. The choice is deterministic (by UTC day), never random.
 */
export const LANDING_CITIES = [
  { label: 'LONDON', lat: 51.507, lng: -0.128 },
  { label: 'NEW YORK', lat: 40.713, lng: -74.006 },
  { label: 'TOKYO', lat: 35.681, lng: 139.767 },
  { label: 'SINGAPORE', lat: 1.29, lng: 103.852 },
  { label: 'SYDNEY', lat: -33.868, lng: 151.209 },
  { label: 'DUBAI', lat: 25.205, lng: 55.271 },
  { label: 'LOS ANGELES', lat: 34.052, lng: -118.244 },
] as const;

export function landingCityFor(date: Date): (typeof LANDING_CITIES)[number] {
  const day = Math.floor(date.getTime() / 86_400_000);
  return LANDING_CITIES[day % LANDING_CITIES.length]!;
}
