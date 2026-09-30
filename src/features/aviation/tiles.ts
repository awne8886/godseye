/**
 * The adsb.lol keyless coverage grid (docs/reference/25 §12 + recommendations): adsb.lol has no
 * all-world endpoint for non-feeders, only `/v2/point/{lat}/{lon}/{≤250 nm}`. A hex-packed lattice
 * of 250 nm circles (alternate rows offset by half a step) tiles the plane without gaps; centres are kept only over boxes where aircraft
 * traffic is densest and adsb.lol feeders see it (hubs plus the North Atlantic tracks); the list
 * is capped at 90 tiles so one sweep at ~1.2 s per request stays within 90–180 s. 30 OSIRIS-style
 * centres gave 7.2k aircraft. Sparse regions are honestly not covered (the layer note says so).
 * Isomorphic and pure.
 */
export const TILE_RADIUS_NM = 250;
const NM_PER_DEG_LAT = 60;
/**
 * Hex packing: centre spacing R·√3 along a row, 1.5·R between rows. The lattice is laid out for a
 * 230 nm radius while each request asks for 250 nm, so the lat/lon distortion of the lattice never
 * opens a gap between circles (tiles.test.ts samples the box interiors).
 */
const LATTICE_RADIUS_NM = 230;
const ROW_SPACING_DEG = (LATTICE_RADIUS_NM * 1.5) / NM_PER_DEG_LAT;
const COL_SPACING_NM = LATTICE_RADIUS_NM * Math.sqrt(3);

/** [west, south, east, north] boxes that the sweep covers. */
export const COVERAGE_BOXES: readonly (readonly [number, number, number, number])[] = [
  [-122, 28, -70, 48], // contiguous US
  [-80, 43, -62, 48], // eastern Canada
  [-104, 16, -88, 23], // Mexico
  [-50, 48, -15, 55], // North Atlantic tracks
  [-8, 38, 28, 58], // Europe
  [32, 24, 56, 38], // Middle East + Gulf
  [72, 14, 88, 28], // India
  [106, 22, 140, 38], // China, Korea, Japan
  [100, -6, 116, 12], // South-East Asia
  [140, -38, 152, -28], // Australia east coast
  [-50, -28, -40, -20], // Brazil south-east
  [20, -34, 30, -26], // South Africa
];

export interface Tile {
  lat: number;
  lon: number;
}

function inBox(lat: number, lon: number): boolean {
  return COVERAGE_BOXES.some(([w, s, e, n]) => lon >= w && lon <= e && lat >= s && lat <= n);
}

/** The sweep's tile centres, west→east within each row, south→north (rounded to 2 dp). */
export function coverageTiles(): Tile[] {
  const out: Tile[] = [];
  let row = 0;
  for (let lat = -46; lat <= 70; lat += ROW_SPACING_DEG, row++) {
    const colDeg = COL_SPACING_NM / (NM_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
    const offset = row % 2 ? colDeg / 2 : 0;
    for (let lon = -180 + offset; lon < 180; lon += colDeg) {
      if (inBox(lat, lon)) out.push({ lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100 });
    }
  }
  return out;
}

/**
 * Interleave rows so consecutive requests land far apart and a partial sweep (after a restart)
 * still spreads across the world instead of filling one continent first.
 */
export function sweepOrder(tiles: readonly Tile[]): Tile[] {
  const stride = 7;
  const out: Tile[] = [];
  for (let start = 0; start < stride; start++) for (let i = start; i < tiles.length; i += stride) out.push(tiles[i]!);
  return out;
}

export function tileUrl(t: Tile): string {
  return `https://api.adsb.lol/v2/point/${t.lat}/${t.lon}/${TILE_RADIUS_NM}`;
}
