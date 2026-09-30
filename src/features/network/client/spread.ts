'use client';
/**
 * Display-only spreading of co-located points (many blocklist IPs geolocate to one city or
 * country label point). The data keeps its true coordinates — the card and pick use them — and
 * only the drawn position is offset on a small pixel-space spiral that is re-derived from the
 * zoom level. Owner: layers-threats-network.
 */
import { useEffect, useState } from 'react';
import { useMapInstance } from '@/lib/layer-host';

/** Zoom rounded to 0.5 steps; re-renders only when that bucket changes. */
export function useZoomBucket(): number {
  const map = useMapInstance();
  const [z, setZ] = useState(() => (map ? Math.round(map.getZoom() * 2) / 2 : 2));
  useEffect(() => {
    if (!map) return;
    const on = () => setZ(Math.round(map.getZoom() * 2) / 2);
    on();
    map.on('zoomend', on);
    return () => {
      map.off('zoomend', on);
    };
  }, [map]);
  return z;
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/**
 * Display positions for `items`: unique points unchanged; the k-th of n co-located points sits on
 * a sunflower spiral `stepPx·√k` pixels from the shared point. Returns [lng, lat] per item and
 * how many share each item's position. Pure.
 */
export function spreadPositions<T extends { lat: number; lng: number }>(items: readonly T[], zoom: number, stepPx = 7): { pos: [number, number][]; shared: number[] } {
  const groups = new Map<string, number[]>();
  items.forEach((t, i) => {
    const k = `${t.lat.toFixed(4)},${t.lng.toFixed(4)}`;
    const g = groups.get(k);
    if (g) g.push(i);
    else groups.set(k, [i]);
  });
  const pos: [number, number][] = items.map((t) => [t.lng, t.lat]);
  const shared: number[] = items.map(() => 1);
  const degPerPx = 360 / (512 * 2 ** zoom);
  for (const idx of groups.values()) {
    if (idx.length < 2) continue;
    idx.forEach((i, k) => {
      shared[i] = idx.length;
      if (k === 0) return;
      const r = stepPx * Math.sqrt(k) * degPerPx;
      const a = k * GOLDEN;
      const t = items[i]!;
      const cos = Math.max(0.2, Math.cos((t.lat * Math.PI) / 180));
      pos[i] = [t.lng + (r * Math.cos(a)) / cos, Math.max(-85, Math.min(85, t.lat + r * Math.sin(a)))];
    });
  }
  return { pos, shared };
}
