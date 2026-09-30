'use client';
/**
 * RainViewer past-radar animation as native MapLibre raster layers (tiles straight from
 * tilecache.rainviewer.com, max zoom 7, overzoomed beyond). One raster source per frame; only the
 * current frame is visible. Animation pauses while the tab is hidden and, under
 * prefers-reduced-motion, the newest frame is shown still. A chip names the frame's UTC time.
 * Owner: layers-hazards.
 */
import type { Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useState } from 'react';
import { useMapInstance } from '@/lib/layer-host';
import type { RadarFramesResponse } from '@/lib/types';
import { useHazardData } from './useHazardData';

const count = (b: RadarFramesResponse) => b.frames.length;
const FRAME_MS = 700;
const OPACITY = 0.65;
const idOf = (i: number) => `hazards-radar-${i}`;

function firstSymbolId(map: MapLibreMap): string | undefined {
  return map.getStyle()?.layers?.find((l) => l.type === 'symbol')?.id;
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

export default function RadarLayer() {
  const map = useMapInstance();
  const data = useHazardData<RadarFramesResponse>('weather_radar', '/api/weather-radar', count);
  const frames = data?.frames;
  // Animation steps since mount; frame 0 of the cycle is the newest frame.
  const [tick, setTick] = useState(0);
  const frame = frames?.length ? (frames.length - 1 + tick) % frames.length : 0;

  // (Re)build the per-frame sources when the frame list changes.
  useEffect(() => {
    if (!map || !frames?.length || !data) return;
    const n = frames.length;
    const add = () => {
      if (!map.getStyle()) return;
      const before = firstSymbolId(map);
      frames.forEach((f, i) => {
        const id = idOf(i);
        if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(id)) map.removeSource(id);
        map.addSource(id, {
          type: 'raster',
          tiles: [`${data.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`],
          tileSize: 256,
          maxzoom: data.maxZoom,
          attribution: '<a href="https://www.rainviewer.com/" target="_blank" rel="noopener noreferrer">RainViewer</a>',
        });
        map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': i === n - 1 ? OPACITY : 0, 'raster-opacity-transition': { duration: 0 }, 'raster-fade-duration': 0 } }, before);
      });
    };
    add();
    return () => {
      try {
        if (!map.getStyle()) return;
        for (let i = 0; i < n; i++) {
          if (map.getLayer(idOf(i))) map.removeLayer(idOf(i));
          if (map.getSource(idOf(i))) map.removeSource(idOf(i));
        }
      } catch {
        // Map torn down.
      }
    };
  }, [map, frames, data]);

  // Animate (paused when hidden; still under reduced motion).
  useEffect(() => {
    if (!frames?.length || reducedMotion()) return;
    const t = setInterval(() => {
      if (document.hidden) return;
      setTick((k) => k + 1);
    }, FRAME_MS);
    return () => clearInterval(t);
  }, [frames]);

  useEffect(() => {
    if (!map || !frames?.length) return;
    for (let i = 0; i < frames.length; i++) {
      if (map.getLayer(idOf(i))) map.setPaintProperty(idOf(i), 'raster-opacity', i === frame ? OPACITY : 0);
    }
  }, [map, frames, frame]);

  const current = frames?.[frame];
  if (!current) return null;
  const t = new Date(current.time);
  return (
    <div
      className="glass-panel pointer-events-none absolute bottom-10 left-1/2 z-[3] -translate-x-1/2 px-3 py-1 font-mono text-[10px] uppercase tracking-[.16em] tabular-nums text-[var(--text-secondary)]"
      aria-live="off"
      data-testid="radar-frame-chip"
    >
      RADAR · RAINVIEWER · {t.toISOString().slice(0, 10)} {t.toISOString().slice(11, 16)} UTC
    </div>
  );
}
