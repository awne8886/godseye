/**
 * Co-located indicators (many blocklist IPs geolocate to one city or country label point) are drawn
 * as ONE point at their shared, true coordinate with a count; the card lists every indicator there.
 * Nothing is ever displaced, jittered or spread (visual-qa M10). Pure; owner: layers-threats-network.
 */

export interface Colocated<T> {
  /** Exact shared coordinate key (`lat,lng` as served). */
  key: string;
  lng: number;
  lat: number;
  /** Every item at exactly this coordinate, in input order. */
  items: T[];
}

/**
 * Groups items by their exact served coordinate. Pure: never changes a coordinate, never drops or
 * duplicates an item — `sum(items.length) === input.length`.
 */
export function groupColocated<T extends { lat: number; lng: number }>(items: readonly T[]): Colocated<T>[] {
  const groups = new Map<string, Colocated<T>>();
  for (const t of items) {
    const key = `${t.lat},${t.lng}`;
    const g = groups.get(key);
    if (g) g.items.push(t);
    else groups.set(key, { key, lng: t.lng, lat: t.lat, items: [t] });
  }
  return [...groups.values()];
}

/** Pixel radius for a group of `n`: `base` for one, `base + 2·√n` for many, capped at 28 px. */
export function colocatedRadiusPx(n: number, base: number): number {
  return n > 1 ? Math.min(28, base + 2 * Math.sqrt(n)) : base;
}

/**
 * Count labels (billboard text) only for groups of ≥ 2. Pass the camera-facing groups
 * (threats/client/globe.ts `useFacing`): the labels then share the points' far-side filter.
 */
export function countLabels<T>(groups: readonly Colocated<T>[]): Colocated<T>[] {
  return groups.filter((g) => g.items.length > 1);
}
