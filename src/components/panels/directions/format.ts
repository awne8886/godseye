/**
 * ROUTE helpers: `lat,lng` parsing (OSIRIS order), the /api/directions query string, and duration
 * formatting. Pure; unit-tested. Owner: panels-recon.
 */
export type Mode = 'drive' | 'walk' | 'bike';

export function parseLatLngText(s: string): { lat: number; lng: number } | null {
  const m = s.trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

const pt = (p: { lat: number; lng: number }) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

export function directionsQuery(from: { lat: number; lng: number }, to: { lat: number; lng: number }, via: { lat: number; lng: number }[], mode: Mode, avoid: { tolls: boolean; highways: boolean; ferries: boolean }): string {
  const q = new URLSearchParams({ from: pt(from), to: pt(to), mode });
  if (via.length) q.set('via', via.map(pt).join('|'));
  const a = (['tolls', 'highways', 'ferries'] as const).filter((k) => avoid[k]);
  if (a.length) q.set('avoid', a.join(','));
  return q.toString();
}

export function formatDuration(s: number): string {
  if (s < 60) return `${Math.round(s)} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}
