'use client';
/**
 * Day/night terminator with civil/nautical/astronomical twilight bands, recomputed every 60 s.
 * (map-engine moves the computation into the geometry worker and adds GIBS Black Marble
 * night lights clipped to the night side.) Owner: map-engine.
 */
import { useEffect, useState } from 'react';
import { Layer, Source } from 'react-map-gl/maplibre';
import { terminatorBands } from '@/lib/solar';
import { TWILIGHT_OPACITY } from '@/lib/map/view';
import { MAP_TOKENS } from '@/lib/tokens';

export default function TerminatorLayer({ beforeId, visible }: { beforeId?: string; visible: boolean }) {
  const [data, setData] = useState(() => terminatorBands(Date.now(), 2));
  useEffect(() => {
    const t = setInterval(() => setData(terminatorBands(Date.now(), 2)), 60_000);
    return () => clearInterval(t);
  }, []);
  return (
    <Source id="day-night" type="geojson" data={data}>
      {Object.entries(TWILIGHT_OPACITY).map(([band, opacity]) => (
        <Layer
          key={band}
          id={`day-night-${band}`}
          type="fill"
          beforeId={beforeId}
          filter={['==', ['get', 'band'], band]}
          layout={{ visibility: visible ? 'visible' : 'none' }}
          paint={{ 'fill-color': MAP_TOKENS['--map-night'], 'fill-opacity': opacity, 'fill-antialias': false }}
        />
      ))}
    </Source>
  );
}
