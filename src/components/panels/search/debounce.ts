/**
 * Type-ahead helpers for SEARCH: a trailing debounce (300 ms) and the query key normalisation
 * shared with react-query's cache. Pure; unit-tested with fake timers. Owner: panels-recon.
 */
export const TYPEAHEAD_DEBOUNCE_MS = 300;
export const TYPEAHEAD_MIN_CHARS = 2;

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms = TYPEAHEAD_DEBOUNCE_MS): ((...a: A) => void) & { cancel: () => void } {
  let t: ReturnType<typeof setTimeout> | null = null;
  const d = (...a: A) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      fn(...a);
    }, ms);
  };
  d.cancel = () => {
    if (t) clearTimeout(t);
    t = null;
  };
  return d;
}

/** Cache key for a query: trimmed, whitespace-collapsed, case-folded. */
export const normalizeQuery = (q: string) => q.trim().replace(/\s+/g, ' ').toLowerCase();

/** Zoom for a result: bbox fit when known, else by place kind. */
export function zoomForPlace(kind: string, bbox: [number, number, number, number] | null): number {
  if (bbox) {
    const span = Math.max(Math.abs(bbox[2] - bbox[0]), Math.abs(bbox[3] - bbox[1]), 0.001);
    return Math.max(2, Math.min(16, Math.log2(360 / span) + 0.5));
  }
  const k = kind.toLowerCase();
  if (k === 'country') return 4.5;
  if (k === 'state' || k === 'region' || k === 'province') return 6;
  if (k === 'city' || k === 'town' || k === 'ip-region') return 10;
  if (k === 'coordinates') return 12;
  return 14;
}
